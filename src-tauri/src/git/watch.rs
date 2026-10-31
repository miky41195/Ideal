use crate::git::runner;
use notify::{RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, mpsc};
use std::time::Duration;
use tauri::{Emitter, EventTarget, Manager, Runtime, WebviewWindow};

const DEBOUNCE: Duration = Duration::from_millis(300);

/// True when a changed path should trigger a refresh (git's own `*.lock` files are noise).
pub fn should_emit(path: &Path) -> bool {
    path.extension().map_or(true, |e| e != "lock")
}

/// One live watcher per window label. Dropping the entry stops the watch thread.
#[derive(Default)]
pub struct GitWatchers(Mutex<HashMap<String, notify::RecommendedWatcher>>);

impl GitWatchers {
    pub fn remove(&self, label: &str) {
        self.0.lock().unwrap().remove(label);
    }
}

fn resolve_git_dir(repo: &Path) -> Option<PathBuf> {
    let out = runner::git_read(repo, &["rev-parse", "--absolute-git-dir"]).ok()?;
    let p = PathBuf::from(out.trim());
    p.is_dir().then_some(p)
}

#[tauri::command(async)]
pub fn git_watch<R: Runtime>(
    window: WebviewWindow<R>,
    watchers: tauri::State<'_, GitWatchers>,
    path: String,
) -> Result<(), String> {
    let label = window.label().to_string();
    // Replace any previous watcher of this window (also when the new path is not a repo).
    watchers.remove(&label);
    let repo = PathBuf::from(&path);
    let Some(git_dir) = resolve_git_dir(&repo) else {
        return Ok(());
    };
    let (tx, rx) = mpsc::channel::<()>();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(ev) = res {
            if ev.paths.iter().any(|p| should_emit(p)) {
                let _ = tx.send(());
            }
        }
    })
    .map_err(|e| e.to_string())?;
    // Non-recursive on the git dir covers HEAD and index; refs/ needs recursion.
    watcher
        .watch(&git_dir, RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;
    let refs = git_dir.join("refs");
    if refs.is_dir() {
        watcher
            .watch(&refs, RecursiveMode::Recursive)
            .map_err(|e| e.to_string())?;
    }
    let app = window.app_handle().clone();
    let target = label.clone();
    // The thread ends when the watcher (owner of tx) is dropped and the channel closes.
    std::thread::spawn(move || {
        while rx.recv().is_ok() {
            while rx.recv_timeout(DEBOUNCE).is_ok() {}
            let _ = app.emit_to(EventTarget::webview_window(&target), "git://changed", &path);
        }
    });
    watchers.0.lock().unwrap().insert(label, watcher);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ignores_lock_files() {
        assert!(!should_emit(Path::new(r"C:\r\.git\index.lock")));
        assert!(!should_emit(Path::new(r"C:\r\.git\refs\heads\main.lock")));
    }

    #[test]
    fn accepts_head_index_refs() {
        assert!(should_emit(Path::new(r"C:\r\.git\HEAD")));
        assert!(should_emit(Path::new(r"C:\r\.git\index")));
        assert!(should_emit(Path::new(r"C:\r\.git\refs\heads\main")));
    }

    #[test]
    fn resolves_git_dir_of_repo_and_none_otherwise() {
        let r = crate::git::test_repo();
        assert!(resolve_git_dir(r.path()).unwrap().ends_with(".git"));
        let plain = tempfile::tempdir().unwrap();
        assert!(resolve_git_dir(plain.path()).is_none());
    }
}
