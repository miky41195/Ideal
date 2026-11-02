use std::io::{ErrorKind, Read};
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn base_cmd(cwd: &Path, args: &[&str], no_locks: bool) -> Command {
    let mut cmd = Command::new("git");
    cmd.args(["-c", "core.quotepath=false", "-c", "color.ui=false"])
        .args(args)
        .current_dir(cwd)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_LITERAL_PATHSPECS", "1")
        .env("LC_ALL", "C")
        .env("LANG", "C");
    if no_locks {
        cmd.env("GIT_OPTIONAL_LOCKS", "0");
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

fn spawn_err(e: std::io::Error) -> String {
    if e.kind() == ErrorKind::NotFound {
        "git non trovato".to_string()
    } else {
        e.to_string()
    }
}

/// Runs git and returns `(exit code, trimmed stderr)` without treating non-zero as failure.
pub fn git_exit(cwd: &Path, args: &[&str]) -> Result<(i32, String), String> {
    let out = base_cmd(cwd, args, true)
        .env("GIT_LITERAL_PATHSPECS", "0") // check-ignore rejects literal pathspecs
        .output().map_err(spawn_err)?;
    Ok((
        out.status.code().unwrap_or(-1),
        String::from_utf8_lossy(&out.stderr).trim().to_string(),
    ))
}

fn run_bytes(cwd: &Path, args: &[&str], no_locks: bool) -> Result<Vec<u8>, String> {
    let out = base_cmd(cwd, args, no_locks).output().map_err(spawn_err)?;
    if out.status.success() {
        Ok(out.stdout)
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

fn run(cwd: &Path, args: &[&str], no_locks: bool) -> Result<String, String> {
    run_bytes(cwd, args, no_locks).map(|b| String::from_utf8_lossy(&b).into_owned())
}

/// Runs git, returning raw stdout bytes (binary-safe), read-only like `git_read`.
pub fn git_read_bytes(cwd: &Path, args: &[&str]) -> Result<Vec<u8>, String> {
    run_bytes(cwd, args, true)
}

/// Runs git, returning stdout. On failure: trimmed stderr.
pub fn git(cwd: &Path, args: &[&str]) -> Result<String, String> {
    run(cwd, args, false)
}

/// Like `git` but with `GIT_OPTIONAL_LOCKS=0` (read-only queries, no index refresh lock).
pub fn git_read(cwd: &Path, args: &[&str]) -> Result<String, String> {
    run(cwd, args, true)
}

fn ssh_batch_wanted(cwd: &Path) -> bool {
    std::env::var_os("GIT_SSH_COMMAND").is_none()
        && git_read(cwd, &["config", "--get", "core.sshCommand"])
            .map(|s| s.trim().is_empty())
            .unwrap_or(true)
}

/// Spawns `cmd`, waits up to `timeout` (polling every 100 ms), kills it on expiry.
pub fn run_with_timeout(mut cmd: Command, timeout: Duration) -> Result<String, String> {
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = cmd.spawn().map_err(|e| {
        if e.kind() == ErrorKind::NotFound {
            "git non trovato".to_string()
        } else {
            e.to_string()
        }
    })?;
    fn drain<R: Read + Send + 'static>(r: Option<R>) -> std::thread::JoinHandle<Vec<u8>> {
        std::thread::spawn(move || {
            let mut b = Vec::new();
            if let Some(mut r) = r {
                let _ = r.read_to_end(&mut b);
            }
            b
        })
    }
    let out_t = drain(child.stdout.take());
    let err_t = drain(child.stderr.take());
    let start = Instant::now();
    let status = loop {
        match child.try_wait().map_err(|e| e.to_string())? {
            Some(s) => break s,
            None if start.elapsed() >= timeout => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("operazione git scaduta ({} s)", timeout.as_secs()));
            }
            None => std::thread::sleep(Duration::from_millis(100)),
        }
    };
    let out = out_t.join().unwrap_or_default();
    let err = err_t.join().unwrap_or_default();
    if status.success() {
        Ok(String::from_utf8_lossy(&out).into_owned())
    } else {
        Err(String::from_utf8_lossy(&err).trim().to_string())
    }
}

/// Network git (fetch/pull/push): ssh BatchMode unless the user configured ssh, wall-clock timeout.
/// Git Credential Manager stays interactive on purpose.
pub fn git_network(cwd: &Path, args: &[&str], timeout: Duration) -> Result<String, String> {
    let mut cmd = Command::new("git");
    cmd.args(["-c", "core.quotepath=false", "-c", "color.ui=false"])
        .args(args)
        .current_dir(cwd)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_LITERAL_PATHSPECS", "1")
        .env("LC_ALL", "C")
        .env("LANG", "C");
    if ssh_batch_wanted(cwd) {
        cmd.env("GIT_SSH_COMMAND", "ssh -o BatchMode=yes");
    }
    run_with_timeout(cmd, timeout)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn timeout_kills_slow_child() {
        let mut c = Command::new("cmd");
        c.args(["/c", "ping", "-n", "6", "127.0.0.1"]);
        let t = Instant::now();
        let e = run_with_timeout(c, Duration::from_millis(500)).unwrap_err();
        assert!(e.contains("scaduta"));
        assert!(t.elapsed() < Duration::from_secs(3));
    }
}
