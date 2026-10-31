use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use crate::claude;

pub type DataCb = Arc<dyn Fn(String) + Send + Sync>;
pub type ExitCb = Arc<dyn Fn(Option<i32>) + Send + Sync>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum PtyKind {
    Claude {
        resume: Option<String>,
        #[serde(default)]
        continue_last: bool,
    },
    Shell {
        program: Option<String>,
    },
}

/// A concrete program invocation.
#[derive(Debug, Clone)]
pub struct Launch {
    pub program: PathBuf,
    pub args: Vec<String>,
}

/// Turn a `PtyKind` into a concrete launch. `.cmd`/`.bat` go through `cmd.exe /c`.
pub fn launch_for(kind: &PtyKind) -> Result<Launch, String> {
    match kind {
        PtyKind::Claude { resume, continue_last } => {
            let exe = claude::resolve_claude(None).map_err(|e| e.to_string())?;
            let mut args = Vec::new();
            if *continue_last {
                args.push("--continue".to_string());
            }
            if let Some(id) = resume {
                args.push("--resume".to_string());
                args.push(id.clone());
            }
            Ok(wrap_script(exe, args))
        }
        PtyKind::Shell { program } => {
            let program = match program {
                Some(p) if !p.trim().is_empty() => PathBuf::from(p),
                _ => which::which("pwsh.exe").unwrap_or_else(|_| PathBuf::from("powershell.exe")),
            };
            Ok(Launch { program, args: vec![] })
        }
    }
}

fn wrap_script(exe: PathBuf, args: Vec<String>) -> Launch {
    let is_script = exe
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("cmd") || e.eq_ignore_ascii_case("bat"))
        .unwrap_or(false);
    if is_script {
        let mut a = vec!["/c".to_string(), exe.to_string_lossy().into_owned()];
        a.extend(args);
        Launch { program: PathBuf::from("cmd.exe"), args: a }
    } else {
        Launch { program: exe, args }
    }
}

struct PtySession {
    master: Arc<Mutex<Option<Box<dyn MasterPty + Send>>>>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    pid: Option<u32>,
}

type Sessions = Arc<Mutex<HashMap<u32, PtySession>>>;

pub struct PtyManager {
    sessions: Sessions,
    next_id: AtomicU32,
}

impl Default for PtyManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Decode UTF-8 chunks lossily, carrying an incomplete trailing sequence over.
#[derive(Default)]
struct Utf8Chunker {
    pending: Vec<u8>,
}

impl Utf8Chunker {
    fn push(&mut self, bytes: &[u8]) -> String {
        self.pending.extend_from_slice(bytes);
        let keep = match std::str::from_utf8(&self.pending) {
            Ok(_) => 0,
            Err(e) if e.error_len().is_none() => self.pending.len() - e.valid_up_to(),
            Err(_) => 0,
        };
        let cut = self.pending.len() - keep;
        let out = String::from_utf8_lossy(&self.pending[..cut]).into_owned();
        self.pending.drain(..cut);
        out
    }
    fn flush(&mut self) -> String {
        let out = String::from_utf8_lossy(&self.pending).into_owned();
        self.pending.clear();
        out
    }
}

fn kill_tree(pid: u32) {
    let mut c = std::process::Command::new("taskkill");
    c.args(["/T", "/F", "/PID", &pid.to_string()]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let _ = c.output();
}

impl PtyManager {
    pub fn new() -> Self {
        Self { sessions: Arc::new(Mutex::new(HashMap::new())), next_id: AtomicU32::new(1) }
    }

    pub fn spawn(
        &self,
        launch: &Launch,
        cwd: &str,
        cols: u16,
        rows: u16,
        on_data: DataCb,
        on_exit: ExitCb,
    ) -> Result<u32, String> {
        if cols == 0 || rows == 0 {
            return Err("invalid size".into());
        }
        let pair = native_pty_system()
            .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| e.to_string())?;
        let mut cmd = CommandBuilder::new(&launch.program);
        cmd.args(&launch.args);
        cmd.cwd(cwd);
        let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
        drop(pair.slave);
        let pid = child.process_id();
        let killer = child.clone_killer();
        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
        let master = Arc::new(Mutex::new(Some(pair.master)));
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);

        let reader_handle = std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            let mut dec = Utf8Chunker::default();
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let s = dec.push(&buf[..n]);
                        if !s.is_empty() {
                            on_data(s);
                        }
                    }
                }
            }
            let rest = dec.flush();
            if !rest.is_empty() {
                on_data(rest);
            }
        });

        self.sessions
            .lock()
            .unwrap()
            .insert(id, PtySession { master: master.clone(), writer, killer, pid });

        // Waiter: after the child exits, close the pty (so the reader hits EOF),
        // drain the reader, then report the exit.
        let sessions = self.sessions.clone();
        std::thread::spawn(move || {
            let code = child.wait().ok().map(|s| s.exit_code() as i32);
            drop(master.lock().unwrap().take());
            let _ = reader_handle.join();
            sessions.lock().unwrap().remove(&id);
            on_exit(code);
        });
        Ok(id)
    }

    pub fn write(&self, id: u32, data: &str) -> Result<(), String> {
        let mut s = self.sessions.lock().unwrap();
        let sess = s.get_mut(&id).ok_or("pty not found")?;
        sess.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
        sess.writer.flush().map_err(|e| e.to_string())
    }

    pub fn resize(&self, id: u32, cols: u16, rows: u16) -> Result<(), String> {
        if cols == 0 || rows == 0 {
            return Err("invalid size".into());
        }
        let s = self.sessions.lock().unwrap();
        let sess = s.get(&id).ok_or("pty not found")?;
        let m = sess.master.lock().unwrap();
        let m = m.as_ref().ok_or("pty closed")?;
        m.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| e.to_string())
    }

    pub fn kill(&self, id: u32) -> Result<(), String> {
        let mut s = self.sessions.lock().unwrap();
        let sess = s.get_mut(&id).ok_or("pty not found")?;
        if let Some(pid) = sess.pid {
            kill_tree(pid);
        }
        let _ = sess.killer.kill();
        Ok(())
    }

    pub fn kill_all(&self) {
        let ids: Vec<u32> = self.sessions.lock().unwrap().keys().copied().collect();
        for id in ids {
            let _ = self.kill(id);
        }
    }

    #[cfg(test)]
    fn pid_of(&self, id: u32) -> Option<u32> {
        self.sessions.lock().unwrap().get(&id).and_then(|s| s.pid)
    }
}

// ---- Tauri adapter ----

use tauri::{AppHandle, Emitter, State};

#[derive(Clone, Serialize)]
struct ExitPayload {
    code: Option<i32>,
}

#[tauri::command]
pub fn pty_spawn(
    app: AppHandle,
    mgr: State<'_, PtyManager>,
    kind: PtyKind,
    cwd: String,
    cols: u16,
    rows: u16,
) -> Result<u32, String> {
    let launch = launch_for(&kind)?;
    // The id is only known after spawn; share it with the callbacks via a cell.
    let cell: Arc<std::sync::OnceLock<u32>> = Arc::new(std::sync::OnceLock::new());
    let (a1, c1) = (app.clone(), cell.clone());
    let on_data: DataCb = Arc::new(move |s| {
        if let Some(id) = c1.get() {
            let _ = a1.emit(&format!("pty://data/{id}"), s);
        }
    });
    let (a2, c2) = (app, cell.clone());
    let on_exit: ExitCb = Arc::new(move |code| {
        if let Some(id) = c2.get() {
            let _ = a2.emit(&format!("pty://exit/{id}"), ExitPayload { code });
        }
    });
    let id = mgr.spawn(&launch, &cwd, cols, rows, on_data, on_exit)?;
    let _ = cell.set(id);
    Ok(id)
}

#[tauri::command]
pub fn pty_write(mgr: State<'_, PtyManager>, id: u32, data: String) -> Result<(), String> {
    mgr.write(id, &data)
}

#[tauri::command]
pub fn pty_resize(mgr: State<'_, PtyManager>, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    mgr.resize(id, cols, rows)
}

#[tauri::command]
pub fn pty_kill(mgr: State<'_, PtyManager>, id: u32) -> Result<(), String> {
    mgr.kill(id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::{Duration, Instant};

    fn cmd(args: &[&str]) -> Launch {
        let mut a = vec!["/c".to_string()];
        a.extend(args.iter().map(|s| s.to_string()));
        Launch { program: PathBuf::from("cmd.exe"), args: a }
    }

    fn run(
        mgr: &PtyManager,
        l: &Launch,
        cwd: &str,
    ) -> (u32, Arc<Mutex<String>>, mpsc::Receiver<Option<i32>>) {
        let out = Arc::new(Mutex::new(String::new()));
        let o = out.clone();
        let (tx, rx) = mpsc::channel();
        let id = mgr
            .spawn(
                l,
                cwd,
                80,
                24,
                Arc::new(move |s| o.lock().unwrap().push_str(&s)),
                Arc::new(move |c| {
                    let _ = tx.send(c);
                }),
            )
            .unwrap();
        (id, out, rx)
    }

    /// ConPTY asks for the cursor position (ESC[6n) at startup and stalls until
    /// answered; in the app xterm.js replies, so tests must play the terminal.
    fn answer_dsr(mgr: &PtyManager, id: u32, out: &Arc<Mutex<String>>, answered: &mut usize) {
        let n = out.lock().unwrap().matches("[6n").count();
        while *answered < n {
            let _ = mgr.write(id, "[1;1R");
            *answered += 1;
        }
    }

    fn wait_for(mgr: &PtyManager, id: u32, out: &Arc<Mutex<String>>, needle: &str) -> bool {
        let t = Instant::now();
        let mut answered = 0;
        while t.elapsed() < Duration::from_secs(5) {
            answer_dsr(mgr, id, out, &mut answered);
            if out.lock().unwrap().contains(needle) {
                return true;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        false
    }

    #[test]
    fn spawn_echo_reads_output() {
        let dir = tempfile::tempdir().unwrap();
        let mgr = PtyManager::new();
        let (id, out, _rx) = run(&mgr, &cmd(&["echo", "hello"]), dir.path().to_str().unwrap());
        assert!(wait_for(&mgr, id, &out, "hello"), "got: {:?}", out.lock().unwrap());
    }

    #[test]
    fn spawn_in_path_with_spaces_and_unicode() {
        let dir = tempfile::tempdir().unwrap();
        let sub = dir.path().join("Mio Progetto è");
        std::fs::create_dir(&sub).unwrap();
        let mgr = PtyManager::new();
        let (id, out, _rx) = run(&mgr, &cmd(&["cd"]), sub.to_str().unwrap());
        assert!(wait_for(&mgr, id, &out, "Mio Progetto è"), "got: {:?}", out.lock().unwrap());
    }

    #[test]
    fn resize_zero_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let mgr = PtyManager::new();
        let (id, _out, _rx) =
            run(&mgr, &cmd(&["ping", "-n", "5", "127.0.0.1"]), dir.path().to_str().unwrap());
        assert_eq!(mgr.resize(id, 0, 10), Err("invalid size".to_string()));
        assert_eq!(mgr.resize(id, 10, 0), Err("invalid size".to_string()));
        assert!(mgr.resize(id, 100, 30).is_ok());
        mgr.kill_all();
    }

    fn pid_alive(pid: u32) -> bool {
        let o = std::process::Command::new("tasklist")
            .args(["/FI", &format!("PID eq {pid}"), "/NH"])
            .output()
            .unwrap();
        String::from_utf8_lossy(&o.stdout).contains(&pid.to_string())
    }

    #[test]
    fn kill_terminates_child() {
        let dir = tempfile::tempdir().unwrap();
        let mgr = PtyManager::new();
        let (id, out, rx) =
            run(&mgr, &cmd(&["ping", "-n", "30", "127.0.0.1"]), dir.path().to_str().unwrap());
        let pid = mgr.pid_of(id).expect("pid");
        assert!(wait_for(&mgr, id, &out, "127.0.0.1"), "got: {:?}", out.lock().unwrap());
        mgr.kill(id).unwrap();
        rx.recv_timeout(Duration::from_secs(3)).expect("exit callback");
        assert!(!pid_alive(pid));
    }

    #[test]
    fn utf8_chunker_splits_multibyte() {
        let mut d = Utf8Chunker::default();
        let b = "è".as_bytes();
        assert_eq!(d.push(&b[..1]), "");
        assert_eq!(d.push(&b[1..]), "è");
    }

    #[test]
    fn claude_args() {
        let l = wrap_script(PathBuf::from("C:\\x\\claude.cmd"), vec!["--resume".into(), "abc".into()]);
        assert_eq!(l.program, PathBuf::from("cmd.exe"));
        assert_eq!(l.args, vec!["/c", "C:\\x\\claude.cmd", "--resume", "abc"]);
    }
}
