use notify::{RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Mutex, mpsc};
use std::time::Duration;
use tauri::{Emitter, EventTarget, Manager, Runtime, WebviewWindow};

const DEBOUNCE: Duration = Duration::from_millis(200);

/// One live recursive watcher per window label. Dropping the entry stops the watch thread.
#[derive(Default)]
pub struct FsWatchers(Mutex<HashMap<String, notify::RecommendedWatcher>>);

impl FsWatchers {
    pub fn remove(&self, label: &str) {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).remove(label);
    }
}

#[derive(Serialize, Clone)]
struct Changed {
    paths: Vec<String>,
}

fn norm(p: &str) -> String {
    p.replace('\\', "/").to_lowercase()
}

/// Drops everything under `<root>/.git` (case-insensitive, either separator) and duplicates.
/// Keeps the original spelling and order of the remaining paths.
pub fn filter_paths(root: &str, paths: &[String]) -> Vec<String> {
    let git = format!("{}/.git", norm(root).trim_end_matches('/'));
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for p in paths {
        let n = norm(p);
        let in_git = n == git || n.starts_with(&format!("{git}/"));
        if in_git || !seen.insert(n) {
            continue;
        }
        out.push(p.clone());
    }
    out
}

#[tauri::command(async)]
pub fn fs_watch<R: Runtime>(
    window: WebviewWindow<R>,
    watchers: tauri::State<'_, FsWatchers>,
    root: String,
) -> Result<(), String> {
    let label = window.label().to_string();
    // Replace any previous watcher of this window.
    watchers.remove(&label);
    if !Path::new(&root).is_dir() {
        return Ok(());
    }
    let (tx, rx) = mpsc::channel::<Vec<String>>();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(ev) = res {
            let paths: Vec<String> = ev.paths.iter().map(|p| p.to_string_lossy().to_string()).collect();
            if !paths.is_empty() {
                let _ = tx.send(paths);
            }
        }
    })
    .map_err(|e| e.to_string())?;
    watcher
        .watch(Path::new(&root), RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;
    let app = window.app_handle().clone();
    let target = label.clone();
    // The thread ends when the watcher (owner of tx) is dropped and the channel closes.
    std::thread::spawn(move || {
        while let Ok(first) = rx.recv() {
            let mut batch = first;
            while let Ok(more) = rx.recv_timeout(DEBOUNCE) {
                batch.extend(more);
            }
            let paths = filter_paths(&root, &batch);
            if paths.is_empty() {
                continue;
            }
            let _ = app.emit_to(EventTarget::webview_window(&target), "fs://changed", Changed { paths });
        }
    });
    watchers.0.lock().unwrap_or_else(|e| e.into_inner()).insert(label, watcher);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filter_drops_git_dir_and_keeps_others() {
        let root = "C:\\proj";
        let paths = vec![
            "C:\\proj\\.git\\index".to_string(),
            "C:\\proj\\.git".to_string(),
            "c:/PROJ/.GIT/HEAD".to_string(),
            "C:\\proj\\src\\a.ts".to_string(),
            "C:\\proj\\.gitignore".to_string(),
            "C:\\proj\\.github\\x.yml".to_string(),
        ];
        let out = filter_paths(root, &paths);
        assert_eq!(
            out,
            vec![
                "C:\\proj\\src\\a.ts".to_string(),
                "C:\\proj\\.gitignore".to_string(),
                "C:\\proj\\.github\\x.yml".to_string(),
            ]
        );
    }

    #[test]
    fn filter_dedups() {
        let p = "C:\\proj\\a.ts".to_string();
        assert_eq!(filter_paths("C:\\proj", &[p.clone(), p.clone()]), vec![p]);
    }
}
