use std::io::ErrorKind;
use std::path::Path;
use std::process::Command;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn run(cwd: &Path, args: &[&str], no_locks: bool) -> Result<String, String> {
    let mut cmd = Command::new("git");
    cmd.args(["-c", "core.quotepath=false", "-c", "color.ui=false"])
        .args(args)
        .current_dir(cwd)
        .env("GIT_TERMINAL_PROMPT", "0")
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
    let out = cmd.output().map_err(|e| {
        if e.kind() == ErrorKind::NotFound {
            "git non trovato".to_string()
        } else {
            e.to_string()
        }
    })?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// Runs git, returning stdout. On failure: trimmed stderr.
pub fn git(cwd: &Path, args: &[&str]) -> Result<String, String> {
    run(cwd, args, false)
}

/// Like `git` but with `GIT_OPTIONAL_LOCKS=0` (read-only queries, no index refresh lock).
pub fn git_read(cwd: &Path, args: &[&str]) -> Result<String, String> {
    run(cwd, args, true)
}
