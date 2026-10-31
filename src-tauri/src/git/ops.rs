use crate::git::{runner::git, status::status_impl};
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Branch {
    pub name: String,
    pub current: bool,
    pub upstream: Option<String>,
}

fn with_files<'a>(head: &[&'a str], files: &'a [String]) -> Vec<&'a str> {
    let mut a: Vec<&str> = head.to_vec();
    a.push("--");
    a.extend(files.iter().map(String::as_str));
    a
}

fn has_head(cwd: &Path) -> bool {
    git(cwd, &["rev-parse", "--verify", "-q", "HEAD"]).is_ok()
}

pub fn stage_impl(cwd: &Path, files: &[String]) -> Result<(), String> {
    if files.is_empty() {
        return Ok(());
    }
    git(cwd, &with_files(&["add"], files)).map(|_| ())
}

pub fn unstage_impl(cwd: &Path, files: &[String]) -> Result<(), String> {
    if files.is_empty() {
        return Ok(());
    }
    let head: &[&str] = if has_head(cwd) {
        &["restore", "--staged"]
    } else {
        &["rm", "--cached", "-r", "-q"]
    };
    git(cwd, &with_files(head, files)).map(|_| ())
}

pub fn discard_with(
    cwd: &Path,
    files: &[String],
    remover: impl Fn(&Path) -> Result<(), String>,
) -> Result<(), String> {
    if files.is_empty() {
        return Ok(());
    }
    let st = status_impl(cwd)?;
    let is_untracked = |f: &String| st.files.iter().any(|c| c.group == "untracked" && &c.path == f);
    let tracked: Vec<String> = files.iter().filter(|f| !is_untracked(f)).cloned().collect();
    if !tracked.is_empty() {
        git(cwd, &with_files(&["restore", "--worktree"], &tracked))?;
    }
    for f in files.iter().filter(|f| is_untracked(f)) {
        let p: PathBuf = cwd.join(f);
        remover(&p)?;
    }
    Ok(())
}

pub fn commit_impl(cwd: &Path, message: &str) -> Result<String, String> {
    let msg = message.trim();
    if msg.is_empty() {
        return Err("messaggio di commit vuoto".to_string());
    }
    git(cwd, &["commit", "-m", msg])?;
    Ok(git(cwd, &["rev-parse", "--short", "HEAD"])?.trim().to_string())
}

pub fn branches_impl(cwd: &Path) -> Result<Vec<Branch>, String> {
    let out = git(
        cwd,
        &["for-each-ref", "refs/heads", "--format=%(HEAD)%09%(refname:short)%09%(upstream:short)"],
    )?;
    Ok(out
        .lines()
        .filter_map(|l| {
            let mut p = l.split('\t');
            let head = p.next()?;
            let name = p.next()?.to_string();
            let up = p.next().unwrap_or("");
            Some(Branch {
                name,
                current: head == "*",
                upstream: if up.is_empty() { None } else { Some(up.to_string()) },
            })
        })
        .collect())
}

pub fn switch_impl(cwd: &Path, name: &str) -> Result<(), String> {
    git(cwd, &["switch", name]).map(|_| ())
}

pub fn create_branch_impl(cwd: &Path, name: &str) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() || git(cwd, &["check-ref-format", "--branch", name]).is_err() {
        return Err("nome branch non valido".to_string());
    }
    git(cwd, &["switch", "-c", name]).map(|_| ())
}

pub fn fetch_impl(cwd: &Path) -> Result<(), String> {
    git(cwd, &["fetch", "--all", "--prune"]).map(|_| ())
}

pub fn pull_impl(cwd: &Path) -> Result<(), String> {
    git(cwd, &["pull", "--ff-only"]).map(|_| ())
}

pub fn push_impl(cwd: &Path) -> Result<(), String> {
    let has_upstream = git(cwd, &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]).is_ok();
    if has_upstream {
        git(cwd, &["push"]).map(|_| ())
    } else {
        git(cwd, &["push", "-u", "origin", "HEAD"]).map(|_| ())
    }
}

#[tauri::command(async)]
pub fn git_stage(path: String, files: Vec<String>) -> Result<(), String> {
    stage_impl(Path::new(&path), &files)
}

#[tauri::command(async)]
pub fn git_unstage(path: String, files: Vec<String>) -> Result<(), String> {
    unstage_impl(Path::new(&path), &files)
}

#[tauri::command(async)]
pub fn git_discard(path: String, files: Vec<String>) -> Result<(), String> {
    discard_with(Path::new(&path), &files, |p| trash::delete(p).map_err(|e| e.to_string()))
}

#[tauri::command(async)]
pub fn git_commit(path: String, message: String) -> Result<String, String> {
    commit_impl(Path::new(&path), &message)
}

#[tauri::command(async)]
pub fn git_branches(path: String) -> Result<Vec<Branch>, String> {
    branches_impl(Path::new(&path))
}

#[tauri::command(async)]
pub fn git_switch(path: String, name: String) -> Result<(), String> {
    switch_impl(Path::new(&path), &name)
}

#[tauri::command(async)]
pub fn git_create_branch(path: String, name: String) -> Result<(), String> {
    create_branch_impl(Path::new(&path), &name)
}

#[tauri::command(async)]
pub fn git_fetch(path: String) -> Result<(), String> {
    fetch_impl(Path::new(&path))
}

#[tauri::command(async)]
pub fn git_pull(path: String) -> Result<(), String> {
    pull_impl(Path::new(&path))
}

#[tauri::command(async)]
pub fn git_push(path: String) -> Result<(), String> {
    push_impl(Path::new(&path))
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::test_repo;
    use std::fs;

    fn commit_file(p: &Path, name: &str, content: &str) {
        fs::write(p.join(name), content).unwrap();
        stage_impl(p, &[name.to_string()]).unwrap();
        commit_impl(p, &format!("add {name}")).unwrap();
    }

    fn s(v: &str) -> Vec<String> {
        vec![v.to_string()]
    }

    #[test]
    fn stage_unstage_roundtrip() {
        let d = test_repo();
        let p = d.path();
        commit_file(p, "a.txt", "1");
        fs::write(p.join("a.txt"), "2").unwrap();
        stage_impl(p, &s("a.txt")).unwrap();
        assert_eq!(status_impl(p).unwrap().files[0].index, "M");
        unstage_impl(p, &s("a.txt")).unwrap();
        let f = &status_impl(p).unwrap().files[0];
        assert_eq!((f.index.as_str(), f.worktree.as_str()), (".", "M"));
    }

    #[test]
    fn unstage_in_unborn_repo() {
        let d = test_repo();
        let p = d.path();
        fs::write(p.join("a.txt"), "1").unwrap();
        stage_impl(p, &s("a.txt")).unwrap();
        unstage_impl(p, &s("a.txt")).unwrap();
        assert_eq!(status_impl(p).unwrap().files[0].group, "untracked");
    }

    #[test]
    fn discard_tracked_restores_content() {
        let d = test_repo();
        let p = d.path();
        commit_file(p, "a.txt", "orig");
        fs::write(p.join("a.txt"), "changed").unwrap();
        discard_with(p, &s("a.txt"), |_| panic!("remover must not run")).unwrap();
        assert_eq!(fs::read_to_string(p.join("a.txt")).unwrap(), "orig");
    }

    #[test]
    fn discard_untracked_uses_remover() {
        let d = test_repo();
        let p = d.path();
        commit_file(p, "a.txt", "orig");
        fs::write(p.join("new.txt"), "x").unwrap();
        let called = std::cell::RefCell::new(Vec::new());
        discard_with(p, &s("new.txt"), |f| {
            called.borrow_mut().push(f.to_path_buf());
            fs::remove_file(f).map_err(|e| e.to_string())
        })
        .unwrap();
        assert_eq!(called.borrow().len(), 1);
        assert!(!p.join("new.txt").exists());
    }

    #[test]
    fn commit_empty_message_rejected() {
        let d = test_repo();
        assert_eq!(commit_impl(d.path(), "  \n ").unwrap_err(), "messaggio di commit vuoto");
    }

    #[test]
    fn commit_returns_hash() {
        let d = test_repo();
        let p = d.path();
        fs::write(p.join("a.txt"), "1").unwrap();
        stage_impl(p, &s("a.txt")).unwrap();
        let h = commit_impl(p, "  hello world \n").unwrap();
        assert!(h.len() >= 7 && h.chars().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(git(p, &["log", "-1", "--format=%s"]).unwrap().trim(), "hello world");
    }

    #[test]
    fn commit_nothing_staged_errors() {
        let d = test_repo();
        assert!(commit_impl(d.path(), "x").is_err());
    }

    #[test]
    fn create_switch_branch() {
        let d = test_repo();
        let p = d.path();
        commit_file(p, "a.txt", "1");
        create_branch_impl(p, "feat/x").unwrap();
        let b = branches_impl(p).unwrap();
        assert!(b.iter().any(|b| b.name == "feat/x" && b.current));
        switch_impl(p, "main").unwrap();
        let b = branches_impl(p).unwrap();
        assert!(b.iter().any(|b| b.name == "main" && b.current));
        assert!(b.iter().any(|b| b.name == "feat/x" && !b.current && b.upstream.is_none()));
    }

    #[test]
    fn invalid_branch_name_rejected() {
        let d = test_repo();
        commit_file(d.path(), "a.txt", "1");
        assert_eq!(create_branch_impl(d.path(), "a..b").unwrap_err(), "nome branch non valido");
    }

    #[test]
    fn push_pull_with_local_bare_remote() {
        let bare = tempfile::tempdir().unwrap();
        git(bare.path(), &["init", "--bare", "-b", "main"]).unwrap();
        let url = bare.path().to_str().unwrap();

        let d = test_repo();
        let p = d.path();
        commit_file(p, "a.txt", "1");
        git(p, &["remote", "add", "origin", url]).unwrap();
        push_impl(p).unwrap();
        let b = branches_impl(p).unwrap();
        assert_eq!(b[0].upstream.as_deref(), Some("origin/main"));

        let c = tempfile::tempdir().unwrap();
        git(c.path(), &["clone", url, "."]).unwrap();
        git(c.path(), &["config", "user.email", "me@ideal.dev"]).unwrap();
        git(c.path(), &["config", "user.name", "Me"]).unwrap();
        commit_file(c.path(), "b.txt", "2");
        push_impl(c.path()).unwrap();

        fetch_impl(p).unwrap();
        pull_impl(p).unwrap();
        assert!(p.join("b.txt").exists());
        push_impl(p).unwrap();
    }

    #[test]
    fn push_bad_remote_fails_fast() {
        let d = test_repo();
        let p = d.path();
        commit_file(p, "a.txt", "1");
        git(p, &["remote", "add", "origin", "C:\\does\\not\\exist"]).unwrap();
        let t = std::time::Instant::now();
        assert!(push_impl(p).is_err());
        assert!(t.elapsed().as_secs() < 15);
    }
}
