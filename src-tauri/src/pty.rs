use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
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
        /// Fixed id for a new session, so its transcript can be found later.
        #[serde(default)]
        session_id: Option<String>,
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

/// Env vars a parent Claude Code session leaks into Ideal when Ideal is launched from it.
/// Passed on, they make the embedded `claude` think it is a child session (e.g. it stops
/// saving transcripts). User config vars like `CLAUDE_CODE_USE_BEDROCK` are kept.
const SESSION_MARKERS: &[&str] = &[
    "CLAUDECODE",
    "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDE_CODE_CHILD_SESSION",
    "CLAUDE_CODE_SSE_PORT",
    "CLAUDE_CODE_SESSION_ID",
];

pub fn session_markers(keys: impl Iterator<Item = String>) -> Vec<String> {
    keys.filter(|k| SESSION_MARKERS.iter().any(|m| m.eq_ignore_ascii_case(k))).collect()
}

/// Turn a `PtyKind` into a concrete launch. `.cmd`/`.bat` go through `cmd.exe /c`.
pub fn launch_for(kind: &PtyKind) -> Result<Launch, String> {
    match kind {
        PtyKind::Claude { resume, continue_last, session_id } => {
            let safe = |id: &str| !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
            if resume.as_deref().is_some_and(|id| !safe(id)) {
                return Err("resume id non valido".to_string());
            }
            if session_id.as_deref().is_some_and(|id| !safe(id)) {
                return Err("session id non valido".to_string());
            }
            let exe = claude::resolve_claude(None).map_err(|e| e.to_string())?;
            let mut args = Vec::new();
            if *continue_last {
                args.push("--continue".to_string());
            }
            if let Some(id) = resume {
                args.push("--resume".to_string());
                args.push(id.clone());
            }
            if let Some(id) = session_id {
                args.push("--session-id".to_string());
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

pub(crate) fn wrap_script(exe: PathBuf, args: Vec<String>) -> Launch {
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

/// Windows Job Object with KILL_ON_JOB_CLOSE: terminating or closing it kills
/// the whole process tree, including grandchildren, even if the app crashes.
pub(crate) struct Job(windows_sys::Win32::Foundation::HANDLE);
unsafe impl Send for Job {}
unsafe impl Sync for Job {}

impl Job {
    pub(crate) fn new(process: Option<std::os::windows::io::RawHandle>) -> Option<Job> {
        use windows_sys::Win32::System::JobObjects::*;
        let process = process?;
        unsafe {
            let h = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if h.is_null() {
                return None;
            }
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let ok = SetInformationJobObject(
                h,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const _,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            if ok == 0 || AssignProcessToJobObject(h, process as _) == 0 {
                windows_sys::Win32::Foundation::CloseHandle(h);
                return None;
            }
            Some(Job(h))
        }
    }
    pub(crate) fn terminate(&self) {
        unsafe {
            windows_sys::Win32::System::JobObjects::TerminateJobObject(self.0, 1);
        }
    }
}

impl Drop for Job {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.0);
        }
    }
}

struct PtySession {
    master: Mutex<Option<Box<dyn MasterPty + Send>>>,
    writer: Mutex<Box<dyn Write + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    pid: Option<u32>,
    job: Option<Job>,
    exited: AtomicBool,
    owner: String,
}

type Sessions = Arc<Mutex<HashMap<u32, Arc<PtySession>>>>;

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
        let mut out = String::new();
        let mut pos = 0;
        loop {
            match std::str::from_utf8(&self.pending[pos..]) {
                Ok(v) => {
                    out.push_str(v);
                    pos = self.pending.len();
                    break;
                }
                Err(e) => {
                    let valid = e.valid_up_to();
                    out.push_str(std::str::from_utf8(&self.pending[pos..pos + valid]).unwrap());
                    pos += valid;
                    match e.error_len() {
                        Some(n) => {
                            out.push('\u{FFFD}');
                            pos += n;
                        }
                        None => break, // incomplete trailing sequence: keep it
                    }
                }
            }
        }
        self.pending.drain(..pos);
        out
    }
    fn flush(&mut self) -> String {
        let out = String::from_utf8_lossy(&self.pending).into_owned();
        self.pending.clear();
        out
    }
}

fn kill_tree(pid: u32) {
    use std::os::windows::process::CommandExt;
    let mut c = std::process::Command::new("taskkill");
    c.args(["/T", "/F", "/PID", &pid.to_string()]);
    c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    let _ = c.output();
}

impl PtyManager {
    pub fn new() -> Self {
        Self { sessions: Arc::new(Mutex::new(HashMap::new())), next_id: AtomicU32::new(1) }
    }

    pub fn spawn(
        &self,
        launch: &Launch,
        owner: &str,
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
        for key in session_markers(std::env::vars().map(|(k, _)| k)) {
            cmd.env_remove(key);
        }
        let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
        drop(pair.slave);
        let pid = child.process_id();
        let job = Job::new(child.as_raw_handle());
        let killer = child.clone_killer();
        let (mut reader, writer) = match (pair.master.try_clone_reader(), pair.master.take_writer())
        {
            (Ok(r), Ok(w)) => (r, w),
            (r, w) => {
                match &job {
                    Some(j) => j.terminate(),
                    None => {
                        if let Some(pid) = pid {
                            kill_tree(pid);
                        }
                    }
                }
                let _ = child.kill();
                let _ = child.wait();
                let e = r.err().map(|e| e.to_string()).or(w.err().map(|e| e.to_string()));
                return Err(e.unwrap_or_else(|| "pty error".into()));
            }
        };
        let session = Arc::new(PtySession {
            master: Mutex::new(Some(pair.master)),
            writer: Mutex::new(writer),
            killer: Mutex::new(killer),
            pid,
            job,
            exited: AtomicBool::new(false),
            owner: owner.to_string(),
        });
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

        self.sessions.lock().unwrap().insert(id, session.clone());

        // Waiter: mark exited, close the pty (so the reader hits EOF),
        // drain the reader, then report the exit.
        let sessions = self.sessions.clone();
        std::thread::spawn(move || {
            let code = child.wait().ok().map(|s| s.exit_code() as i32);
            session.exited.store(true, Ordering::SeqCst);
            let m = session.master.lock().unwrap().take();
            drop(m);
            let _ = reader_handle.join();
            sessions.lock().unwrap().remove(&id);
            on_exit(code);
        });
        Ok(id)
    }

    fn get(&self, id: u32) -> Result<Arc<PtySession>, String> {
        self.sessions.lock().unwrap().get(&id).cloned().ok_or_else(|| "pty not found".to_string())
    }

    pub fn write(&self, id: u32, data: &str) -> Result<(), String> {
        let sess = self.get(id)?;
        let mut w = sess.writer.lock().unwrap();
        w.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
        w.flush().map_err(|e| e.to_string())
    }

    pub fn resize(&self, id: u32, cols: u16, rows: u16) -> Result<(), String> {
        if cols == 0 || rows == 0 {
            return Err("invalid size".into());
        }
        let sess = self.get(id)?;
        let m = sess.master.lock().unwrap();
        let m = m.as_ref().ok_or("pty closed")?;
        m.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| e.to_string())
    }

    /// Kill the whole process tree. Unknown or already-exited ids are Ok.
    pub fn kill(&self, id: u32) -> Result<(), String> {
        let Ok(sess) = self.get(id) else { return Ok(()) };
        if sess.exited.load(Ordering::SeqCst) {
            return Ok(());
        }
        if let Some(job) = &sess.job {
            job.terminate();
        } else {
            if let Some(pid) = sess.pid {
                if !sess.exited.load(Ordering::SeqCst) {
                    kill_tree(pid);
                }
            }
            let _ = sess.killer.lock().unwrap().kill();
        }
        Ok(())
    }

    /// Kill every session spawned by the window with this label.
    pub fn kill_owned_by(&self, owner: &str) {
        let ids: Vec<u32> = self
            .sessions
            .lock()
            .unwrap()
            .iter()
            .filter(|(_, s)| s.owner == owner)
            .map(|(id, _)| *id)
            .collect();
        for id in ids {
            let _ = self.kill(id);
        }
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

use tauri::ipc::Channel;
use tauri::State;

#[derive(Clone, Serialize)]
pub struct ExitPayload {
    code: Option<i32>,
}

#[tauri::command(async)]
pub fn pty_spawn(
    mgr: State<'_, PtyManager>,
    window: tauri::Window,
    kind: PtyKind,
    cwd: String,
    cols: u16,
    rows: u16,
    on_data: Channel<String>,
    on_exit: Channel<ExitPayload>,
) -> Result<u32, String> {
    let launch = launch_for(&kind)?;
    let data_cb: DataCb = Arc::new(move |s| {
        let _ = on_data.send(s);
    });
    let exit_cb: ExitCb = Arc::new(move |code| {
        let _ = on_exit.send(ExitPayload { code });
    });
    mgr.spawn(&launch, window.label(), &cwd, cols, rows, data_cb, exit_cb)
}

#[tauri::command(async)]
pub fn pty_write(mgr: State<'_, PtyManager>, id: u32, data: String) -> Result<(), String> {
    mgr.write(id, &data)
}

#[tauri::command(async)]
pub fn pty_resize(mgr: State<'_, PtyManager>, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    mgr.resize(id, cols, rows)
}

#[tauri::command(async)]
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
                "test",
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
        let n = out.lock().unwrap().matches("\x1b[6n").count();
        while *answered < n {
            let _ = mgr.write(id, "\x1b[1;1R");
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
    fn session_markers_only_strips_session_vars() {
        let keys = ["CLAUDECODE", "CLAUDE_CODE_CHILD_SESSION", "CLAUDE_CODE_USE_BEDROCK", "PATH", "claude_code_entrypoint"];
        let got = session_markers(keys.iter().map(|s| s.to_string()));
        assert_eq!(got, vec!["CLAUDECODE", "CLAUDE_CODE_CHILD_SESSION", "claude_code_entrypoint"]);
    }

    #[test]
    fn spawn_echo_reads_output() {
        let dir = tempfile::tempdir().unwrap();
        let mgr = PtyManager::new();
        // `ab^cd` echoes as `abcd`, which never appears in the command line itself.
        let (id, out, _rx) = run(&mgr, &cmd(&["echo", "ab^cd"]), dir.path().to_str().unwrap());
        assert!(wait_for(&mgr, id, &out, "abcd"), "got: {:?}", out.lock().unwrap());
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

    #[test]
    fn kill_owned_by_only_kills_that_owner() {
        let dir = tempfile::tempdir().unwrap();
        let cwd = dir.path().to_str().unwrap();
        let mgr = PtyManager::new();
        let l = cmd(&["ping", "-n", "30", "127.0.0.1"]);
        let spawn_as = |owner: &str| {
            let (tx, rx) = mpsc::channel();
            let out = Arc::new(Mutex::new(String::new()));
            let o = out.clone();
            let id = mgr
                .spawn(
                    &l,
                    owner,
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
        };
        let (a, out_a, rx_a) = spawn_as("win-a");
        let (b, out_b, rx_b) = spawn_as("win-b");
        // Play the terminal: answer ConPTY's cursor-position request.
        let (mut na, mut nb) = (0, 0);
        let t = Instant::now();
        while t.elapsed() < Duration::from_secs(2) {
            answer_dsr(&mgr, a, &out_a, &mut na);
            answer_dsr(&mgr, b, &out_b, &mut nb);
            std::thread::sleep(Duration::from_millis(50));
        }
        mgr.kill_owned_by("win-a");
        assert!(rx_a.recv_timeout(Duration::from_secs(5)).is_ok(), "owner a should exit");
        assert!(rx_b.recv_timeout(Duration::from_millis(500)).is_err(), "owner b must stay alive");
        assert!(mgr.get(b).is_ok());
        mgr.kill_all();
        assert!(rx_b.recv_timeout(Duration::from_secs(5)).is_ok());
    }

    fn pid_alive(pid: u32) -> bool {
        let o = std::process::Command::new("tasklist")
            .args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"])
            .output()
            .unwrap();
        let want = pid.to_string();
        String::from_utf8_lossy(&o.stdout)
            .lines()
            .any(|l| l.split("\",\"").nth(1).map(|f| f.trim_matches('"')) == Some(want.as_str()))
    }

    fn child_pids(parent: u32) -> Vec<u32> {
        let o = std::process::Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                &format!(
                    "(Get-CimInstance Win32_Process -Filter 'ParentProcessId={parent}').ProcessId"
                ),
            ])
            .output()
            .unwrap();
        String::from_utf8_lossy(&o.stdout).lines().filter_map(|l| l.trim().parse().ok()).collect()
    }

    #[test]
    fn kill_terminates_child() {
        let dir = tempfile::tempdir().unwrap();
        let mgr = PtyManager::new();
        let (id, out, rx) =
            run(&mgr, &cmd(&["ping", "-n", "30", "127.0.0.1"]), dir.path().to_str().unwrap());
        let pid = mgr.pid_of(id).expect("pid");
        assert!(wait_for(&mgr, id, &out, "127.0.0.1"), "got: {:?}", out.lock().unwrap());
        let kids = child_pids(pid);
        assert!(!kids.is_empty(), "expected ping.exe child of cmd");
        mgr.kill(id).unwrap();
        rx.recv_timeout(Duration::from_secs(3)).expect("exit callback");
        assert!(!pid_alive(pid));
        for k in kids {
            assert!(!pid_alive(k), "descendant {k} still alive");
        }
        assert!(mgr.kill(id).is_ok(), "kill after exit is Ok");
        assert!(mgr.kill(9999).is_ok(), "kill unknown is Ok");
    }

    #[test]
    fn resume_id_validated() {
        let bad = PtyKind::Claude { resume: Some("a b; calc".into()), continue_last: false, session_id: None };
        assert_eq!(launch_for(&bad).unwrap_err(), "resume id non valido");
        let empty = PtyKind::Claude { resume: Some("".into()), continue_last: false, session_id: None };
        assert_eq!(launch_for(&empty).unwrap_err(), "resume id non valido");
        let sid = PtyKind::Claude { resume: None, continue_last: false, session_id: Some("a b; calc".into()) };
        assert_eq!(launch_for(&sid).unwrap_err(), "session id non valido");
    }

    #[test]
    fn utf8_chunker_splits_multibyte() {
        let mut d = Utf8Chunker::default();
        let b = "è".as_bytes();
        assert_eq!(d.push(&b[..1]), "");
        assert_eq!(d.push(&b[1..]), "è");
    }

    #[test]
    fn utf8_chunker_invalid_then_incomplete() {
        let mut d = Utf8Chunker::default();
        let mut bytes = b"a\xFFb".to_vec();
        bytes.push("è".as_bytes()[0]);
        assert_eq!(d.push(&bytes), "a\u{FFFD}b");
        assert_eq!(d.push(&"è".as_bytes()[1..]), "è");
    }

    #[test]
    fn claude_args() {
        let l = wrap_script(PathBuf::from("C:\\x\\claude.cmd"), vec!["--resume".into(), "abc".into()]);
        assert_eq!(l.program, PathBuf::from("cmd.exe"));
        assert_eq!(l.args, vec!["/c", "C:\\x\\claude.cmd", "--resume", "abc"]);
    }
}
