//! Language server processes: spawn, frame stdio, report exit, kill the tree.

use super::frame::{self, Decoder};
use super::servers;
use crate::pty::{wrap_script, Job};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::os::windows::io::AsRawHandle;
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;
use tauri::{Manager, Runtime, State, WebviewWindow};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const STDERR_RING: usize = 64 * 1024;

pub type Sink = Arc<dyn Fn(String) + Send + Sync>;

/// User override from settings.json `"lsp": { "<languageId>": {command,args} | false }`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Override {
    Disabled,
    Custom { command: String, args: Vec<String> },
}

/// Reads the `lsp` map out of a settings document; invalid entries are ignored one by one.
pub fn parse_overrides(settings: &Value) -> HashMap<String, Override> {
    let mut out = HashMap::new();
    let Some(map) = settings.get("lsp").and_then(|v| v.as_object()) else { return out };
    for (lang, v) in map {
        match v {
            Value::Bool(false) => {
                out.insert(lang.clone(), Override::Disabled);
            }
            Value::Object(o) => {
                let Some(command) = o.get("command").and_then(|c| c.as_str()).filter(|c| !c.trim().is_empty()) else {
                    continue;
                };
                let args = match o.get("args") {
                    None => Vec::new(),
                    Some(Value::Array(a)) => {
                        let strs: Vec<String> = a.iter().filter_map(|x| x.as_str().map(String::from)).collect();
                        if strs.len() != a.len() {
                            continue;
                        }
                        strs
                    }
                    Some(_) => continue,
                };
                out.insert(lang.clone(), Override::Custom { command: command.to_string(), args });
            }
            _ => {}
        }
    }
    out
}

/// Overrides from `<dir>/settings.json`; unreadable or invalid file means none.
pub fn load_overrides(dir: &std::path::Path) -> HashMap<String, Override> {
    std::fs::read_to_string(dir.join("settings.json"))
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(t.trim_start_matches('\u{feff}')).ok())
        .map(|v| parse_overrides(&v))
        .unwrap_or_default()
}

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LspStarted {
    pub server_id: u32,
    pub reused: bool,
}

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LspStartError {
    pub missing: bool,
    pub command: String,
    pub install: String,
    pub message: String,
}

impl LspStartError {
    fn other(command: &str, install: &str, message: String) -> Self {
        Self { missing: false, command: command.into(), install: install.into(), message }
    }
}

struct Server {
    owner: String,
    key: String,
    stdin: Mutex<ChildStdin>,
    job: Job,
    exited: AtomicBool,
    #[allow(dead_code)] // read via stderr_tail (diagnostics for early exits)
    stderr: Arc<Mutex<Vec<u8>>>,
}

#[derive(Default)]
pub struct LspServers {
    servers: Arc<Mutex<HashMap<u32, Arc<Server>>>>,
    next_id: AtomicU32,
}

fn exit_message(code: Option<i32>) -> String {
    let code = code.map_or("null".to_string(), |c| c.to_string());
    format!("{{\"jsonrpc\":\"2.0\",\"method\":\"$/ideal/exit\",\"params\":{{\"code\":{code}}}}}")
}

/// 6 × 50 ms: how long a freshly spawned server must survive to count as started.
const EARLY_EXIT_CHECKS: u32 = 6;

/// Error for a server that exited right after spawn. Stub/launcher messages that mean
/// "not installed" become `missing` so the UI shows the install command.
pub fn early_exit_error(command: &str, install: &str, code: Option<i32>, stderr: &str) -> LspStartError {
    let low = stderr.to_lowercase();
    let missing = ["unknown binary", "is not installed", "not recognized", "not found"]
        .iter()
        .any(|p| low.contains(p));
    let mut msg: String = stderr.chars().take(500).collect();
    if msg.is_empty() {
        msg = format!("{command} terminato subito (codice {})", code.map_or("?".into(), |c| c.to_string()));
    }
    LspStartError { missing, command: command.into(), install: install.into(), message: msg }
}

fn drain_stderr(mut err: impl Read, ring: Arc<Mutex<Vec<u8>>>) {
    let mut buf = [0u8; 4096];
    while let Ok(n) = err.read(&mut buf) {
        if n == 0 {
            break;
        }
        let mut r = ring.lock().unwrap_or_else(|e| e.into_inner());
        r.extend_from_slice(&buf[..n]);
        let over = r.len().saturating_sub(STDERR_RING);
        if over > 0 {
            r.drain(..over);
        }
    }
}

/// Resolve, spawn (or reuse) the server for `language_id`, owned by window `owner`.
pub fn start_impl(
    mgr: &LspServers,
    owner: &str,
    language_id: &str,
    root: &str,
    overrides: &HashMap<String, Override>,
    lookup: &dyn Fn(&str) -> Option<PathBuf>,
    sink: Sink,
) -> Result<LspStarted, LspStartError> {
    let spec = servers::spec_for(language_id);
    let install = spec.map_or("", |s| s.install);
    let (command, args): (String, Vec<String>) = match overrides.get(language_id) {
        Some(Override::Disabled) => {
            return Err(LspStartError::other("", "", "Server LSP disattivato nelle impostazioni".into()));
        }
        Some(Override::Custom { command, args }) => (command.clone(), args.clone()),
        None => match spec {
            Some(s) => (s.command.to_string(), s.args.iter().map(|a| a.to_string()).collect()),
            None => {
                return Err(LspStartError::other("", "", format!("Linguaggio non supportato: {language_id}")));
            }
        },
    };
    let key = match overrides.get(language_id) {
        Some(Override::Custom { command, .. }) => command.clone(),
        _ => servers::server_key(language_id).unwrap_or(&command).to_string(),
    };

    // One server per (window, key): reuse a live one.
    {
        let map = mgr.servers.lock().unwrap_or_else(|e| e.into_inner());
        for (id, s) in map.iter() {
            if s.owner == owner && s.key == key && !s.exited.load(Ordering::SeqCst) {
                return Ok(LspStarted { server_id: *id, reused: true });
            }
        }
    }

    let Some(exe) = lookup(&command) else {
        return Err(LspStartError {
            missing: true,
            command: command.clone(),
            install: install.to_string(),
            message: format!("{command} non trovato"),
        });
    };
    let launch = wrap_script(exe, args);
    let mut child: Child = Command::new(&launch.program)
        .args(&launch.args)
        .current_dir(root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|e| LspStartError::other(&command, install, format!("Avvio di {command} non riuscito: {e}")))?;
    let Some(job) = Job::new(Some(child.as_raw_handle())) else {
        let _ = child.kill();
        return Err(LspStartError::other(&command, install, "Impossibile isolare il processo del server".into()));
    };
    let stdin = child.stdin.take().expect("piped stdin");
    let mut stdout = child.stdout.take().expect("piped stdout");
    let stderr = child.stderr.take().expect("piped stderr");
    let ring = Arc::new(Mutex::new(Vec::new()));
    let drainer = {
        let ring = ring.clone();
        std::thread::spawn(move || drain_stderr(stderr, ring))
    };
    // A launcher stub (e.g. the rustup proxy without the component) exits at once:
    // report it as a start error, not as a running server that later "crashes".
    for _ in 0..EARLY_EXIT_CHECKS {
        if let Ok(Some(status)) = child.try_wait() {
            let _ = drainer.join();
            let tail = String::from_utf8_lossy(&ring.lock().unwrap_or_else(|e| e.into_inner())).trim().to_string();
            return Err(early_exit_error(&command, install, status.code(), &tail));
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    let id = mgr.next_id.fetch_add(1, Ordering::SeqCst) + 1;
    let server = Arc::new(Server {
        owner: owner.to_string(),
        key,
        stdin: Mutex::new(stdin),
        job,
        exited: AtomicBool::new(false),
        stderr: ring,
    });
    mgr.servers.lock().unwrap_or_else(|e| e.into_inner()).insert(id, server.clone());

    let map = mgr.servers.clone();
    std::thread::spawn(move || {
        let mut dec = Decoder::default();
        let mut buf = [0u8; 16 * 1024];
        while let Ok(n) = stdout.read(&mut buf) {
            if n == 0 {
                break;
            }
            for m in dec.push(&buf[..n]) {
                sink(m);
            }
        }
        let code = child.wait().ok().and_then(|s| s.code());
        server.exited.store(true, Ordering::SeqCst);
        map.lock().unwrap_or_else(|e| e.into_inner()).remove(&id);
        sink(exit_message(code));
    });
    Ok(LspStarted { server_id: id, reused: false })
}

impl LspServers {
    fn get(&self, id: u32) -> Option<Arc<Server>> {
        self.servers.lock().unwrap_or_else(|e| e.into_inner()).get(&id).cloned()
    }

    pub fn send(&self, id: u32, message: &str) -> Result<(), String> {
        let gone = || "Server LSP terminato".to_string();
        let s = self.get(id).ok_or_else(gone)?;
        if s.exited.load(Ordering::SeqCst) {
            return Err(gone());
        }
        let mut w = s.stdin.lock().unwrap_or_else(|e| e.into_inner());
        w.write_all(&frame::encode(message)).and_then(|_| w.flush()).map_err(|_| gone())
    }

    /// Kills the server's process tree. The reader thread then reports the exit.
    pub fn stop(&self, id: u32) -> Result<(), String> {
        let s = self.get(id).ok_or_else(|| "Server LSP terminato".to_string())?;
        s.job.terminate();
        Ok(())
    }

    pub fn stop_owned_by(&self, owner: &str) {
        let ids: Vec<u32> = self
            .servers
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .iter()
            .filter(|(_, s)| s.owner == owner)
            .map(|(id, _)| *id)
            .collect();
        for id in ids {
            let _ = self.stop(id);
            // Remove right away so a late send fails even before the reader notices.
            if let Some(s) = self.servers.lock().unwrap_or_else(|e| e.into_inner()).remove(&id) {
                s.exited.store(true, Ordering::SeqCst);
            }
        }
    }

    #[allow(dead_code)]
    /// Last stderr output (up to 64 KB) of a server, for diagnostics.
    pub fn stderr_tail(&self, id: u32) -> Option<String> {
        let s = self.get(id)?;
        let r = s.stderr.lock().unwrap_or_else(|e| e.into_inner());
        Some(String::from_utf8_lossy(&r).into_owned())
    }
}

#[tauri::command(async)]
pub fn lsp_start<R: Runtime>(
    window: WebviewWindow<R>,
    mgr: State<'_, LspServers>,
    language_id: String,
    root: String,
    on_message: Channel<String>,
) -> Result<LspStarted, LspStartError> {
    let overrides = load_overrides(&crate::settings::config_dir());
    let sink: Sink = Arc::new(move |s| {
        let _ = on_message.send(s);
    });
    let lookup = |c: &str| which::which(c).ok();
    let _ = window.app_handle(); // keep Manager in scope for generic R
    start_impl(&mgr, window.label(), &language_id, &root, &overrides, &lookup, sink)
}

#[tauri::command(async)]
pub fn lsp_send(mgr: State<'_, LspServers>, server_id: u32, message: String) -> Result<(), String> {
    mgr.send(server_id, &message)
}

#[tauri::command(async)]
pub fn lsp_stop(mgr: State<'_, LspServers>, server_id: u32) -> Result<(), String> {
    mgr.stop(server_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    fn node_available() -> bool {
        if which::which("node").is_ok() {
            true
        } else {
            eprintln!("note: node not on PATH, skipping LSP process test");
            false
        }
    }

    fn custom(args: &[&str]) -> HashMap<String, Override> {
        custom_for("typescript", args)
    }

    fn custom_for(language: &str, args: &[&str]) -> HashMap<String, Override> {
        let mut m = HashMap::new();
        m.insert(
            language.to_string(),
            Override::Custom { command: "node".into(), args: args.iter().map(|s| s.to_string()).collect() },
        );
        m
    }

    fn sink() -> (Sink, mpsc::Receiver<String>) {
        let (tx, rx) = mpsc::channel();
        let tx = Mutex::new(tx);
        (Arc::new(move |s| { let _ = tx.lock().unwrap().send(s); }), rx)
    }

    fn real_lookup(c: &str) -> Option<PathBuf> {
        which::which(c).ok()
    }

    const ECHO: &str = "let b=Buffer.alloc(0);process.stdin.on('data',d=>{b=Buffer.concat([b,d]);const i=b.indexOf('\\r\\n\\r\\n');if(i<0)return;const m=/Content-Length: (\\d+)/i.exec(b.slice(0,i).toString());const n=+m[1];if(b.length<i+4+n)return;const r=JSON.stringify({jsonrpc:'2.0',id:1,result:42});process.stdout.write('Content-Length: '+Buffer.byteLength(r)+'\\r\\n\\r\\n'+r);b=b.slice(i+4+n);});";
    const SLEEP: &str = "setInterval(()=>{},1000)";

    #[test]
    fn start_send_receive_reply() {
        if !node_available() { return; }
        let mgr = LspServers::default();
        let (s, rx) = sink();
        let st = start_impl(&mgr, "w1", "typescript", ".", &custom(&["-e", ECHO]), &real_lookup, s).unwrap();
        assert!(!st.reused);
        mgr.send(st.server_id, "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"x\"}").unwrap();
        let got = rx.recv_timeout(Duration::from_secs(10)).unwrap();
        assert_eq!(got, "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":42}");
        mgr.stop(st.server_id).unwrap();
    }

    #[test]
    fn same_window_and_key_is_reused() {
        if !node_available() { return; }
        let mgr = LspServers::default();
        let (s, _rx) = sink();
        let ov = custom(&["-e", SLEEP]);
        let a = start_impl(&mgr, "w1", "typescript", ".", &ov, &real_lookup, s.clone()).unwrap();
        let b = start_impl(&mgr, "w1", "typescript", ".", &ov, &real_lookup, s.clone()).unwrap();
        assert!(b.reused);
        assert_eq!(a.server_id, b.server_id);
        let c = start_impl(&mgr, "w2", "typescript", ".", &ov, &real_lookup, s).unwrap();
        assert!(!c.reused);
        assert_ne!(a.server_id, c.server_id);
        mgr.stop_owned_by("w1");
        assert!(mgr.send(a.server_id, "{}").is_err());
        assert!(mgr.send(c.server_id, "{}").is_ok());
        mgr.stop_owned_by("w2");
    }

    #[test]
    fn missing_command_reports_install() {
        let mgr = LspServers::default();
        let (s, _rx) = sink();
        let none = |_: &str| None;
        let e = start_impl(&mgr, "w", "rust", ".", &HashMap::new(), &none, s).unwrap_err();
        assert!(e.missing);
        assert_eq!(e.command, "rust-analyzer");
        assert_eq!(e.install, "rustup component add rust-analyzer");
    }

    #[test]
    fn disabled_and_unknown_are_not_missing() {
        let mgr = LspServers::default();
        let (s, _rx) = sink();
        let mut ov = HashMap::new();
        ov.insert("rust".to_string(), Override::Disabled);
        let e = start_impl(&mgr, "w", "rust", ".", &ov, &real_lookup, s.clone()).unwrap_err();
        assert!(!e.missing);
        let e = start_impl(&mgr, "w", "klingon", ".", &HashMap::new(), &real_lookup, s).unwrap_err();
        assert!(!e.missing);
    }

    #[test]
    fn stop_kills_process() {
        if !node_available() { return; }
        let mgr = LspServers::default();
        let (s, rx) = sink();
        let st = start_impl(&mgr, "w", "typescript", ".", &custom(&["-e", SLEEP]), &real_lookup, s).unwrap();
        mgr.stop(st.server_id).unwrap();
        let msg = rx.recv_timeout(Duration::from_secs(10)).unwrap();
        assert!(msg.contains("$/ideal/exit"), "{msg}");
        assert!(mgr.send(st.server_id, "{}").is_err());
    }

    #[test]
    fn exit_emits_ideal_exit() {
        if !node_available() { return; }
        let mgr = LspServers::default();
        let (s, rx) = sink();
        // Exits after the early-exit window: a running server that later dies.
        start_impl(&mgr, "w", "typescript", ".", &custom(&["-e", "setTimeout(() => process.exit(3), 1500)"]), &real_lookup, s).unwrap();
        let msg = rx.recv_timeout(Duration::from_secs(10)).unwrap();
        assert_eq!(msg, "{\"jsonrpc\":\"2.0\",\"method\":\"$/ideal/exit\",\"params\":{\"code\":3}}");
    }

    #[test]
    fn immediate_exit_is_a_start_error() {
        if !node_available() { return; }
        let mgr = LspServers::default();
        let (s, _rx) = sink();
        let script = "process.stderr.write(\"error: Unknown binary 'rust-analyzer.exe'\"); process.exit(1)";
        let err = start_impl(&mgr, "w", "rust", ".", &custom_for("rust", &["-e", script]), &real_lookup, s).unwrap_err();
        assert!(err.missing, "{err:?}");
        assert!(err.message.contains("Unknown binary"));
    }

    #[test]
    fn early_exit_error_classifies() {
        let e = early_exit_error("rust-analyzer", "rustup component add rust-analyzer", Some(1), "error: Unknown binary 'rust-analyzer.exe' in official toolchain");
        assert!(e.missing);
        assert_eq!(e.install, "rustup component add rust-analyzer");
        let e = early_exit_error("x", "", Some(2), "panic: boom");
        assert!(!e.missing);
        let e = early_exit_error("x", "", Some(2), "");
        assert_eq!(e.message, "x terminato subito (codice 2)");
    }

    #[test]
    fn overrides_parse_leniently() {
        let v = serde_json::json!({
            "lsp": {
                "rust": false,
                "python": {"command": "mypy-ls", "args": ["--x"]},
                "go": {"command": 5},
                "java": true,
                "c": {"command": "clangd"}
            }
        });
        let o = parse_overrides(&v);
        assert!(matches!(o.get("rust"), Some(Override::Disabled)));
        assert!(matches!(o.get("python"), Some(Override::Custom { command, args }) if command == "mypy-ls" && args == &["--x"]));
        assert!(matches!(o.get("c"), Some(Override::Custom { args, .. }) if args.is_empty()));
        assert!(o.get("go").is_none() && o.get("java").is_none());
        assert!(parse_overrides(&serde_json::json!({"lsp": 3})).is_empty());
        assert!(parse_overrides(&serde_json::json!({})).is_empty());
    }
}
