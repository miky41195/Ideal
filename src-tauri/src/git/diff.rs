use crate::git::runner;
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
pub struct DiffText {
    pub old: String,
    pub new: String,
    pub binary: bool,
}

const BINARY_SCAN: usize = 8192;

fn is_binary(b: &[u8]) -> bool {
    b[..b.len().min(BINARY_SCAN)].contains(&0)
}

fn missing_path(e: &str) -> bool {
    e.contains("exists on disk, but not in")
        || e.contains("does not exist in")
        || e.contains("neither on disk nor in the index")
}

/// `git show <spec>` as bytes; `None` if the path is simply absent from that rev/index.
fn show(cwd: &Path, spec: &str) -> Result<Option<Vec<u8>>, String> {
    match runner::git_read_bytes(cwd, &["show", spec]) {
        Ok(b) => Ok(Some(b)),
        Err(e) if missing_path(&e) => Ok(None),
        Err(e) => Err(e),
    }
}

fn rev_exists(cwd: &Path, rev: &str) -> bool {
    runner::git_read(cwd, &["rev-parse", "--verify", "-q", rev]).is_ok()
}

fn build(old: Option<Vec<u8>>, new: Option<Vec<u8>>) -> DiffText {
    let (old, new) = (old.unwrap_or_default(), new.unwrap_or_default());
    if is_binary(&old) || is_binary(&new) {
        return DiffText { old: String::new(), new: String::new(), binary: true };
    }
    DiffText {
        old: String::from_utf8_lossy(&old).into_owned(),
        new: String::from_utf8_lossy(&new).into_owned(),
        binary: false,
    }
}

fn valid_hash(h: &str) -> bool {
    !h.is_empty() && h.len() <= 64 && h.chars().all(|c| c.is_ascii_hexdigit())
}

pub fn file_diff_impl(cwd: &Path, file: &str, staged: bool) -> Result<DiffText, String> {
    if staged {
        let old = if rev_exists(cwd, "HEAD") { show(cwd, &format!("HEAD:{file}"))? } else { None };
        let new = show(cwd, &format!(":{file}"))?;
        Ok(build(old, new))
    } else {
        let old = match show(cwd, &format!(":{file}"))? {
            Some(b) => Some(b),
            None if rev_exists(cwd, "HEAD") => show(cwd, &format!("HEAD:{file}"))?,
            None => None,
        };
        let new = std::fs::read(cwd.join(file)).ok();
        Ok(build(old, new))
    }
}

pub fn commit_file_diff_impl(
    cwd: &Path,
    hash: &str,
    file: &str,
    old_path: Option<&str>,
) -> Result<DiffText, String> {
    if !valid_hash(hash) {
        return Err("hash non valido".into());
    }
    let parent = format!("{hash}^");
    let old = if rev_exists(cwd, &parent) {
        show(cwd, &format!("{parent}:{}", old_path.unwrap_or(file)))?
    } else {
        None
    };
    let new = show(cwd, &format!("{hash}:{file}"))?;
    Ok(build(old, new))
}

#[tauri::command(async)]
pub fn git_file_diff(path: String, file: String, staged: bool) -> Result<DiffText, String> {
    file_diff_impl(Path::new(&path), &file, staged)
}

#[tauri::command(async)]
pub fn git_commit_file_diff(
    path: String,
    hash: String,
    file: String,
    old_path: Option<String>,
) -> Result<DiffText, String> {
    commit_file_diff_impl(Path::new(&path), &hash, &file, old_path.as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::test_repo;

    fn commit_all(p: &Path, msg: &str) {
        runner::git(p, &["add", "-A"]).unwrap();
        runner::git(p, &["commit", "-m", msg]).unwrap();
    }

    #[test]
    fn file_diff_staged_new_file_old_empty() {
        let d = test_repo();
        std::fs::write(d.path().join("n.txt"), "ciao\n").unwrap();
        runner::git(d.path(), &["add", "n.txt"]).unwrap();
        let r = file_diff_impl(d.path(), "n.txt", true).unwrap();
        assert_eq!(r, DiffText { old: String::new(), new: "ciao\n".into(), binary: false });
    }

    #[test]
    fn file_diff_unstaged_modified() {
        let d = test_repo();
        std::fs::write(d.path().join("a.txt"), "uno\n").unwrap();
        commit_all(d.path(), "c1");
        std::fs::write(d.path().join("a.txt"), "due\n").unwrap();
        let r = file_diff_impl(d.path(), "a.txt", false).unwrap();
        assert_eq!((r.old.as_str(), r.new.as_str()), ("uno\n", "due\n"));
        std::fs::remove_file(d.path().join("a.txt")).unwrap();
        let r = file_diff_impl(d.path(), "a.txt", false).unwrap();
        assert_eq!((r.old.as_str(), r.new.as_str()), ("uno\n", ""));
    }

    #[test]
    fn file_diff_binary_flagged() {
        let d = test_repo();
        std::fs::write(d.path().join("b.bin"), [1u8, 0, 2]).unwrap();
        let r = file_diff_impl(d.path(), "b.bin", false).unwrap();
        assert!(r.binary && r.old.is_empty() && r.new.is_empty());
    }

    #[test]
    fn commit_file_diff_root_commit_old_empty() {
        let d = test_repo();
        std::fs::write(d.path().join("a.txt"), "uno\n").unwrap();
        commit_all(d.path(), "root");
        let h = runner::git(d.path(), &["rev-parse", "HEAD"]).unwrap();
        let r = commit_file_diff_impl(d.path(), h.trim(), "a.txt", None).unwrap();
        assert_eq!((r.old.as_str(), r.new.as_str()), ("", "uno\n"));
        std::fs::write(d.path().join("a.txt"), "due\n").unwrap();
        commit_all(d.path(), "c2");
        let h = runner::git(d.path(), &["rev-parse", "HEAD"]).unwrap();
        let r = commit_file_diff_impl(d.path(), h.trim(), "a.txt", None).unwrap();
        assert_eq!((r.old.as_str(), r.new.as_str()), ("uno\n", "due\n"));
    }
}
