use notify::{RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Mutex, mpsc};
use std::time::Duration;
use tauri::{Emitter, EventTarget, Manager, Runtime, WebviewWindow};

const DEBOUNCE: Duration = Duration::from_millis(200);
/// A folder that never goes quiet (a running build, a log being written) still gets its changes out.
const MAX_WAIT: Duration = Duration::from_secs(2);

/// `first` plus whatever arrives until `debounce` passes without news, or `max_wait` has elapsed.
pub fn collect_batch(rx: &mpsc::Receiver<Vec<String>>, first: Vec<String>, debounce: Duration, max_wait: Duration) -> Vec<String> {
    let start = std::time::Instant::now();
    let mut batch = first;
    while start.elapsed() < max_wait {
        match rx.recv_timeout(debounce) {
            Ok(more) => batch.extend(more),
            Err(_) => break,
        }
    }
    batch
}

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

/// Build/dependency folders that churn thousands of files during `npm install` / `cargo build`.
/// Tabs open inside them are not auto-reloaded (rare; reopen the file).
const NOISY_DIRS: &[&str] = &["node_modules", "target"];

/// True when `n` (normalized) lies under a noisy folder below `root_norm`.
fn is_noisy(root_norm: &str, n: &str) -> bool {
    let rel = n.strip_prefix(root_norm).unwrap_or(n);
    rel.split('/').any(|seg| NOISY_DIRS.contains(&seg))
}

/// Drops everything under `<root>/.git`, under `node_modules`/`target` folders, (case-insensitive, either separator) and duplicates.
/// Keeps the original spelling and order of the remaining paths.
pub fn filter_paths(root: &str, paths: &[String]) -> Vec<String> {
    let root_norm = norm(root).trim_end_matches('/').to_string();
    let git = format!("{root_norm}/.git");
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for p in paths {
        let n = norm(p);
        let in_git = n == git || n.starts_with(&format!("{git}/"));
        if in_git || is_noisy(&root_norm, &n) || !seen.insert(n) {
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
    let root_cb = root.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(ev) = res {
            let paths: Vec<String> = ev.paths.iter().map(|p| p.to_string_lossy().to_string()).collect();
            // Filter here, not after batching: build-folder churn must not keep the debounce open.
            let paths = filter_paths(&root_cb, &paths);
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
            let batch = collect_batch(&rx, first, DEBOUNCE, MAX_WAIT);
            let paths = filter_paths(&root, &batch); // dedup across events
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
    fn filter_drops_noisy_build_dirs() {
        let paths = vec![
            "C:\\proj\\node_modules\\x\\index.js".to_string(),
            "C:\\proj\\src-tauri\\target\\debug\\a.rlib".to_string(),
            "C:\\proj\\src\\target_list.ts".to_string(),
            "C:\\proj\\src\\main.ts".to_string(),
        ];
        assert_eq!(
            filter_paths("C:\\proj", &paths),
            vec!["C:\\proj\\src\\target_list.ts".to_string(), "C:\\proj\\src\\main.ts".to_string()]
        );
    }

    #[test]
    fn noisy_check_ignores_root_name() {
        // A project whose own folder is called "target" must still be watched.
        assert!(!is_noisy("c:/work/target", "c:/work/target/src/a.rs"));
    }

    #[test]
    fn filter_dedups() {
        let p = "C:\\proj\\a.ts".to_string();
        assert_eq!(filter_paths("C:\\proj", &[p.clone(), p.clone()]), vec![p]);
    }

    #[test]
    fn batch_ends_at_max_wait_even_if_events_never_stop() {
        let (tx, rx) = mpsc::channel::<Vec<String>>();
        let feeder = std::thread::spawn(move || {
            for i in 0..60 {
                if tx.send(vec![format!("f{i}")]).is_err() {
                    break;
                }
                std::thread::sleep(Duration::from_millis(20));
            }
        });
        let t = std::time::Instant::now();
        let batch = collect_batch(&rx, vec!["first".into()], Duration::from_millis(200), Duration::from_millis(300));
        let took = t.elapsed();
        assert!(took < Duration::from_millis(700), "took {took:?}");
        assert!(batch.len() > 1 && batch.len() < 61);
        drop(rx);
        let _ = feeder.join();
    }

    #[test]
    fn batch_ends_after_quiet_debounce() {
        let (tx, rx) = mpsc::channel::<Vec<String>>();
        tx.send(vec!["b".into()]).unwrap();
        let batch = collect_batch(&rx, vec!["a".into()], Duration::from_millis(50), Duration::from_secs(5));
        assert_eq!(batch, vec!["a".to_string(), "b".to_string()]);
    }
}
