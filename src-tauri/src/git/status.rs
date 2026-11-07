use crate::git::runner;
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: String,
    pub orig_path: Option<String>,
    pub index: String,
    pub worktree: String,
    pub group: String,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RepoStatus {
    pub is_repo: bool,
    pub branch: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub files: Vec<FileChange>,
}

fn change(path: &str, orig: Option<&str>, index: char, worktree: char, group: &str) -> FileChange {
    FileChange {
        path: path.to_string(),
        orig_path: orig.map(str::to_string),
        index: index.to_string(),
        worktree: worktree.to_string(),
        group: group.to_string(),
    }
}

pub fn parse_porcelain_v2(z: &str) -> RepoStatus {
    let mut st = RepoStatus {
        is_repo: true,
        ..Default::default()
    };
    let mut fields = z.split('\0');
    while let Some(f) = fields.next() {
        if f.is_empty() {
            continue;
        }
        if let Some(h) = f.strip_prefix("# ") {
            if let Some(b) = h.strip_prefix("branch.head ") {
                if b != "(detached)" {
                    st.branch = Some(b.to_string());
                }
            } else if let Some(u) = h.strip_prefix("branch.upstream ") {
                st.upstream = Some(u.to_string());
            } else if let Some(ab) = h.strip_prefix("branch.ab ") {
                for part in ab.split(' ') {
                    if let Some(n) = part.strip_prefix('+') {
                        st.ahead = n.parse().unwrap_or(0);
                    } else if let Some(n) = part.strip_prefix('-') {
                        st.behind = n.parse().unwrap_or(0);
                    }
                }
            }
            continue;
        }
        let kind = f.as_bytes()[0];
        match kind {
            b'1' | b'2' => {
                let n = if kind == b'1' { 9 } else { 10 };
                let parts: Vec<&str> = f.splitn(n, ' ').collect();
                if parts.len() < n {
                    continue;
                }
                let orig = if kind == b'2' { fields.next() } else { None };
                let mut xy = parts[1].chars();
                let (x, y) = (xy.next().unwrap_or('.'), xy.next().unwrap_or('.'));
                let path = parts[n - 1];
                if x != '.' {
                    st.files.push(change(path, orig, x, y, "staged"));
                }
                if y != '.' {
                    st.files.push(change(path, orig, x, y, "unstaged"));
                }
            }
            b'u' => {
                let parts: Vec<&str> = f.splitn(11, ' ').collect();
                if parts.len() < 11 {
                    continue;
                }
                let mut xy = parts[1].chars();
                let (x, y) = (xy.next().unwrap_or('U'), xy.next().unwrap_or('U'));
                st.files.push(change(parts[10], None, x, y, "conflict"));
            }
            b'?' => {
                if let Some(p) = f.strip_prefix("? ") {
                    st.files.push(change(p, None, '?', '?', "untracked"));
                }
            }
            _ => {}
        }
    }
    st
}

pub fn status_impl(cwd: &Path) -> Result<RepoStatus, String> {
    match runner::git_read(
        cwd,
        &[
            "status",
            "--porcelain=v2",
            "--branch",
            "-z",
            "--untracked-files=all",
        ],
    ) {
        Ok(out) => Ok(parse_porcelain_v2(&out)),
        Err(e) if e.to_lowercase().contains("not a git repository") => Ok(RepoStatus::default()),
        Err(e) => Err(e),
    }
}

#[tauri::command(async)]
pub fn git_status(path: String) -> Result<RepoStatus, String> {
    status_impl(Path::new(&path))
}

/// Root of the repo containing `path` (OS separators), or None outside a repo.
/// The Git panel works at the repo root so status paths and diffs line up when the
/// project is a subfolder of a repository.
pub fn toplevel_impl(path: &Path) -> Option<String> {
    let out = runner::git_read(path, &["rev-parse", "--show-toplevel"]).ok()?;
    let top = out.trim();
    if top.is_empty() {
        return None;
    }
    Some(if cfg!(windows) { top.replace('/', "\\") } else { top.to_string() })
}

#[tauri::command(async)]
pub fn git_toplevel(path: String) -> Option<String> {
    toplevel_impl(Path::new(&path))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::{runner, test_repo};

    #[test]
    fn parse_branch_ahead_behind() {
        let s = parse_porcelain_v2(
            "# branch.oid abc\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +2 -1\0",
        );
        assert!(s.is_repo);
        assert_eq!(s.branch.as_deref(), Some("main"));
        assert_eq!(s.upstream.as_deref(), Some("origin/main"));
        assert_eq!((s.ahead, s.behind), (2, 1));
    }

    #[test]
    fn parse_rename_and_spaces() {
        let z =
            "2 R. N... 100644 100644 100644 aaa bbb R100 Mio file è.txt\0old name.txt\0? x y.txt\0";
        let s = parse_porcelain_v2(z);
        assert_eq!(s.files.len(), 2);
        assert_eq!(s.files[0].path, "Mio file è.txt");
        assert_eq!(s.files[0].orig_path.as_deref(), Some("old name.txt"));
        assert_eq!(s.files[0].group, "staged");
        assert_eq!(s.files[1].path, "x y.txt");
        assert_eq!(s.files[1].group, "untracked");
    }

    #[test]
    fn status_never_runs_fsmonitor_from_repo_config() {
        let d = test_repo();
        let p = d.path();
        let marker = p.join("pwned");
        let hook = format!("echo x > '{}'", marker.to_string_lossy().replace('\\', "/"));
        runner::git(p, &["config", "core.fsmonitor", &hook]).unwrap();
        std::fs::write(p.join("a.txt"), "a").unwrap();
        status_impl(p).unwrap();
        assert!(!marker.exists(), "fsmonitor hook from .git/config was executed");
    }

    #[test]
    fn parse_unborn() {
        let s = parse_porcelain_v2("# branch.oid (initial)\0# branch.head main\0");
        assert_eq!(s.branch.as_deref(), Some("main"));
    }

    #[test]
    fn parse_unmerged() {
        let s = parse_porcelain_v2("u UU N... 100644 100644 100644 100644 a b c conf.txt\0");
        assert_eq!(s.files.len(), 1);
        assert_eq!(s.files[0].group, "conflict");
        assert_eq!(s.files[0].path, "conf.txt");
    }

    #[test]
    fn toplevel_from_subfolder_and_outside() {
        let d = test_repo();
        let sub = d.path().join("app").join("src");
        std::fs::create_dir_all(&sub).unwrap();
        let top = toplevel_impl(&sub).expect("inside repo");
        let want = std::fs::canonicalize(d.path()).unwrap();
        let got = std::fs::canonicalize(&top).unwrap();
        assert_eq!(got, want);
        assert!(!top.contains('/') || !cfg!(windows));
        let outside = tempfile::tempdir().unwrap();
        assert_eq!(toplevel_impl(outside.path()), None);
    }

    #[test]
    fn status_not_repo() {
        let d = tempfile::tempdir().unwrap();
        let s = status_impl(d.path()).unwrap();
        assert!(!s.is_repo);
        assert!(s.files.is_empty());
    }

    #[test]
    fn status_real_repo() {
        let d = test_repo();
        std::fs::write(d.path().join("a.txt"), "a").unwrap();
        std::fs::write(d.path().join("b.txt"), "b").unwrap();
        runner::git(d.path(), &["add", "--", "b.txt"]).unwrap();
        let s = status_impl(d.path()).unwrap();
        assert!(s.is_repo);
        assert_eq!(s.branch.as_deref(), Some("main"));
        let a = s.files.iter().find(|f| f.path == "a.txt").unwrap();
        assert_eq!(a.group, "untracked");
        let b = s.files.iter().find(|f| f.path == "b.txt").unwrap();
        assert_eq!(b.group, "staged");
    }

    #[test]
    fn status_both_staged_and_modified() {
        let d = test_repo();
        let f = d.path().join("c.txt");
        std::fs::write(&f, "1").unwrap();
        runner::git(d.path(), &["add", "--", "c.txt"]).unwrap();
        runner::git(d.path(), &["commit", "-m", "init"]).unwrap();
        std::fs::write(&f, "2").unwrap();
        runner::git(d.path(), &["add", "--", "c.txt"]).unwrap();
        std::fs::write(&f, "3").unwrap();
        let s = status_impl(d.path()).unwrap();
        let c: Vec<_> = s.files.iter().filter(|x| x.path == "c.txt").collect();
        assert_eq!(c.len(), 2);
        assert!(c.iter().any(|x| x.group == "staged"));
        assert!(c.iter().any(|x| x.group == "unstaged"));
    }
}
