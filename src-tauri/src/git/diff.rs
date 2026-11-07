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
        || e.contains("but not at stage 0")
        || e.contains("unknown revision or path not in the working tree")
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
        return DiffText {
            old: String::new(),
            new: String::new(),
            binary: true,
        };
    }
    DiffText {
        old: String::from_utf8_lossy(&old).into_owned(),
        new: String::from_utf8_lossy(&new).into_owned(),
        binary: false,
    }
}

use crate::git::history::valid_hash;

fn valid_path(file: &str) -> bool {
    use std::path::Component;
    let p = Path::new(file);
    !file.is_empty()
        && !p.is_absolute()
        && p.components()
            .all(|c| matches!(c, Component::Normal(_) | Component::CurDir))
}

fn read_worktree(cwd: &Path, file: &str) -> Result<Option<Vec<u8>>, String> {
    match std::fs::read(cwd.join(file)) {
        Ok(b) => Ok(Some(b)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

fn crlf_to_lf(b: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(b.len());
    for (i, c) in b.iter().enumerate() {
        if *c == b'\r' && b.get(i + 1) == Some(&b'\n') {
            continue;
        }
        out.push(*c);
    }
    out
}

/// `old_path`: HEAD-side name for staged renames (defaults to `file`).
pub fn file_diff_impl(
    cwd: &Path,
    file: &str,
    staged: bool,
    old_path: Option<&str>,
) -> Result<DiffText, String> {
    if !valid_path(file) || old_path.is_some_and(|o| !valid_path(o)) {
        return Err("percorso non valido".into());
    }
    // `./` makes the path relative to cwd (project may be a subfolder of the repo).
    if staged {
        let head_file = old_path.unwrap_or(file);
        let old = if rev_exists(cwd, "HEAD") {
            show(cwd, &format!("HEAD:./{head_file}"))?
        } else {
            None
        };
        let new = show(cwd, &format!(":./{file}"))?;
        Ok(build(old, new))
    } else {
        let old = match show(cwd, &format!(":./{file}"))? {
            Some(b) => Some(b),
            None if rev_exists(cwd, "HEAD") => show(cwd, &format!("HEAD:./{file}"))?,
            None => None,
        };
        let mut new = read_worktree(cwd, file)?;
        // autocrlf: index side is LF while the worktree is raw CRLF; compare like with like.
        if let (Some(o), Some(n)) = (&old, &new) {
            if !o.contains(&b'\r') && n.contains(&b'\r') {
                new = Some(crlf_to_lf(n));
            }
        }
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
    if !valid_path(file) || old_path.is_some_and(|o| !valid_path(o)) {
        return Err("percorso non valido".into());
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
pub fn git_file_diff(
    path: String,
    file: String,
    staged: bool,
    old_path: Option<String>,
) -> Result<DiffText, String> {
    file_diff_impl(Path::new(&path), &file, staged, old_path.as_deref())
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
        let r = file_diff_impl(d.path(), "n.txt", true, None).unwrap();
        assert_eq!(
            r,
            DiffText {
                old: String::new(),
                new: "ciao\n".into(),
                binary: false
            }
        );
    }

    #[test]
    fn file_diff_unstaged_modified() {
        let d = test_repo();
        std::fs::write(d.path().join("a.txt"), "uno\n").unwrap();
        commit_all(d.path(), "c1");
        std::fs::write(d.path().join("a.txt"), "due\n").unwrap();
        let r = file_diff_impl(d.path(), "a.txt", false, None).unwrap();
        assert_eq!((r.old.as_str(), r.new.as_str()), ("uno\n", "due\n"));
        std::fs::remove_file(d.path().join("a.txt")).unwrap();
        let r = file_diff_impl(d.path(), "a.txt", false, None).unwrap();
        assert_eq!((r.old.as_str(), r.new.as_str()), ("uno\n", ""));
    }

    #[test]
    fn file_diff_binary_flagged() {
        let d = test_repo();
        std::fs::write(d.path().join("b.bin"), [1u8, 0, 2]).unwrap();
        let r = file_diff_impl(d.path(), "b.bin", false, None).unwrap();
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

    #[test]
    fn unstaged_crlf_worktree_normalized() {
        let d = test_repo();
        std::fs::write(d.path().join("a.txt"), "uno\ndue\ntre\n").unwrap();
        commit_all(d.path(), "c1");
        std::fs::write(d.path().join("a.txt"), "uno\r\nDUE\r\ntre\r\n").unwrap();
        let r = file_diff_impl(d.path(), "a.txt", false, None).unwrap();
        assert!(!r.new.contains('\r'));
        assert_eq!(r.new, "uno\nDUE\ntre\n");
    }

    #[test]
    fn rejects_bad_paths() {
        let d = test_repo();
        assert!(file_diff_impl(d.path(), "../x", false, None).is_err());
        assert!(file_diff_impl(d.path(), "/etc/passwd", true, None).is_err());
        assert!(commit_file_diff_impl(d.path(), "abc", "a/../b", None).is_err());
    }

    #[test]
    fn staged_deletion_new_empty() {
        let d = test_repo();
        std::fs::write(d.path().join("a.txt"), "uno\n").unwrap();
        commit_all(d.path(), "c1");
        runner::git(d.path(), &["rm", "-q", "a.txt"]).unwrap();
        let r = file_diff_impl(d.path(), "a.txt", true, None).unwrap();
        assert_eq!((r.old.as_str(), r.new.as_str()), ("uno\n", ""));
    }

    #[test]
    fn commit_file_diff_rename_added_deleted() {
        let d = test_repo();
        std::fs::write(d.path().join("old.txt"), "uno\n").unwrap();
        std::fs::write(d.path().join("gone.txt"), "bye\n").unwrap();
        commit_all(d.path(), "c1");
        runner::git(d.path(), &["mv", "old.txt", "new.txt"]).unwrap();
        runner::git(d.path(), &["rm", "-q", "gone.txt"]).unwrap();
        std::fs::write(d.path().join("added.txt"), "nuovo\n").unwrap();
        commit_all(d.path(), "c2");
        let h = runner::git(d.path(), &["rev-parse", "HEAD"]).unwrap();
        let h = h.trim();
        let r = commit_file_diff_impl(d.path(), h, "new.txt", Some("old.txt")).unwrap();
        assert_eq!((r.old.as_str(), r.new.as_str()), ("uno\n", "uno\n"));
        let r = commit_file_diff_impl(d.path(), h, "added.txt", None).unwrap();
        assert_eq!((r.old.as_str(), r.new.as_str()), ("", "nuovo\n"));
        let r = commit_file_diff_impl(d.path(), h, "gone.txt", None).unwrap();
        assert_eq!((r.old.as_str(), r.new.as_str()), ("bye\n", ""));
    }

    #[test]
    fn conflicted_file_falls_back_to_head() {
        let d = test_repo();
        let p = d.path();
        std::fs::write(p.join("a.txt"), "base\n").unwrap();
        commit_all(p, "base");
        runner::git(p, &["checkout", "-q", "-b", "other"]).unwrap();
        std::fs::write(p.join("a.txt"), "other\n").unwrap();
        commit_all(p, "other");
        runner::git(p, &["checkout", "-q", "main"]).unwrap();
        std::fs::write(p.join("a.txt"), "main\n").unwrap();
        commit_all(p, "main");
        let _ = runner::git(p, &["merge", "other"]);
        let r = file_diff_impl(p, "a.txt", false, None).unwrap();
        assert_eq!(r.old, "main\n");
    }

    #[test]
    fn subfolder_cwd_diff_uses_relative_paths() {
        let d = test_repo();
        let p = d.path();
        std::fs::create_dir(p.join("sub")).unwrap();
        std::fs::write(
            p.join("sub/a.txt"),
            "uno
",
        )
        .unwrap();
        commit_all(p, "c1");
        std::fs::write(
            p.join("sub/a.txt"),
            "due
",
        )
        .unwrap();
        let sub = p.join("sub");
        let r = file_diff_impl(&sub, "a.txt", false, None).unwrap();
        assert_eq!(
            (r.old.as_str(), r.new.as_str()),
            (
                "uno
", "due
"
            )
        );
        runner::git(&sub, &["add", "a.txt"]).unwrap();
        let r = file_diff_impl(&sub, "a.txt", true, None).unwrap();
        assert_eq!(
            (r.old.as_str(), r.new.as_str()),
            (
                "uno
", "due
"
            )
        );
    }

    #[test]
    fn staged_rename_old_side_uses_old_path() {
        let d = test_repo();
        let p = d.path();
        std::fs::write(
            p.join("old.txt"),
            "uno
",
        )
        .unwrap();
        commit_all(p, "c1");
        runner::git(p, &["mv", "old.txt", "new.txt"]).unwrap();
        let r = file_diff_impl(p, "new.txt", true, Some("old.txt")).unwrap();
        assert_eq!(
            (r.old.as_str(), r.new.as_str()),
            (
                "uno
", "uno
"
            )
        );
        let r = file_diff_impl(p, "new.txt", true, None).unwrap();
        assert_eq!(r.old, "");
    }
}
