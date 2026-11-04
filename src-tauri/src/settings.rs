use notify::{RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::mpsc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

const DEFAULTS_JSON: &str = include_str!("defaults/settings.json");
const MAX_RECENT: usize = 10;
const DEBOUNCE: Duration = Duration::from_millis(200);

static STATE_LOCK: Mutex<()> = Mutex::new(());

// ---------- types ----------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default, rename_all = "camelCase")]
pub struct TerminalSettings {
    pub shell: Option<String>,
    pub font_size: u16,
}
impl Default for TerminalSettings {
    fn default() -> Self {
        Self { shell: None, font_size: 13 }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default, rename_all = "camelCase")]
pub struct EditorSettings {
    pub font_size: u16,
    pub tab_size: u8,
    pub font_family: String,
}
impl Default for EditorSettings {
    fn default() -> Self {
        Self { font_size: 14, tab_size: 2, font_family: "Cascadia Code, Consolas, monospace".into() }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default, rename_all = "camelCase")]
pub struct ClaudeMemSettings {
    pub port: u16,
}
impl Default for ClaudeMemSettings {
    fn default() -> Self {
        Self { port: 37777 }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default, rename_all = "camelCase")]
pub struct LayoutSettings {
    pub sidebar_width: u16,
    pub panel_height: u16,
}
impl Default for LayoutSettings {
    fn default() -> Self {
        Self { sidebar_width: 260, panel_height: 220 }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    pub terminal: TerminalSettings,
    pub editor: EditorSettings,
    pub theme: String,
    pub claude_mem: ClaudeMemSettings,
    pub layout: LayoutSettings,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            terminal: Default::default(),
            editor: Default::default(),
            theme: "ideal-dark".into(),
            claude_mem: Default::default(),
            layout: Default::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct SettingsWithWarning {
    pub settings: Settings,
    pub warning: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default, rename_all = "camelCase")]
pub struct LayoutState {
    pub sidebar_width: Option<u16>,
    pub panel_height: Option<u16>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct AppState {
    pub recent_projects: Vec<String>,
    pub layout: HashMap<String, LayoutState>,
}

// ---------- pure logic ----------

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// Merge `over` into `base`: objects merge key by key, anything else replaces.
fn deep_merge(base: &mut Value, over: Value) {
    match (base, over) {
        (Value::Object(b), Value::Object(o)) => {
            for (k, v) in o {
                match b.get_mut(&k) {
                    Some(slot) => deep_merge(slot, v),
                    None => {
                        b.insert(k, v);
                    }
                }
            }
        }
        (slot, v) => *slot = v,
    }
}

fn merged(user: Value) -> Result<Settings, String> {
    let mut base: Value = serde_json::from_str(DEFAULTS_JSON).map_err(err)?;
    deep_merge(&mut base, user);
    serde_json::from_value(base).map_err(err)
}

pub fn load(dir: &Path) -> SettingsWithWarning {
    let defaults = |warning: Option<String>| SettingsWithWarning { settings: Settings::default(), warning };
    let text = match std::fs::read_to_string(dir.join("settings.json")) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return defaults(None),
        Err(e) => return defaults(Some(format!("impossibile leggere settings.json: {e}"))),
    };
    let result = serde_json::from_str::<Value>(text.trim_start_matches('\u{feff}'))
        .map_err(err)
        .and_then(|v| if v.is_object() { merged(v) } else { Err("deve essere un oggetto JSON".into()) });
    match result {
        Ok(settings) => SettingsWithWarning { settings, warning: None },
        Err(e) => defaults(Some(format!("settings.json non valido: {e}"))),
    }
}

pub fn load_state(dir: &Path) -> AppState {
    let path = dir.join("state.json");
    let Ok(text) = std::fs::read_to_string(&path) else { return AppState::default() };
    match serde_json::from_str(text.trim_start_matches('\u{feff}')) {
        Ok(s) => s,
        Err(e) => {
            // Keep the corrupt file around before a later save overwrites it.
            eprintln!("state.json corrotto ({e}); salvato come state.json.bad");
            let _ = std::fs::rename(&path, dir.join("state.json.bad"));
            AppState::default()
        }
    }
}

pub fn save_state(dir: &Path, state: &AppState) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(err)?;
    let data = serde_json::to_string_pretty(state).map_err(err)?;
    let mut tmp = tempfile::NamedTempFile::new_in(dir).map_err(err)?;
    tmp.write_all(data.as_bytes()).map_err(err)?;
    tmp.as_file().sync_all().map_err(err)?;
    let target = dir.join("state.json");
    // On Windows a rename can transiently fail under contention; retry briefly.
    let mut last = None;
    for _ in 0..20 {
        match tmp.persist(&target) {
            Ok(_) => return Ok(()),
            Err(e) => {
                tmp = e.file;
                last = Some(e.error);
                std::thread::sleep(Duration::from_millis(10));
            }
        }
    }
    Err(err(last.unwrap()))
}

fn path_key(path: &str) -> String {
    path.replace('\\', "/").trim_end_matches('/').to_lowercase()
}

pub fn add_recent_impl(dir: &Path, path: &str) -> Result<Vec<String>, String> {
    let _g = STATE_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let mut state = load_state(dir);
    let key = path_key(path);
    state.recent_projects.retain(|p| path_key(p) != key);
    state.recent_projects.insert(0, path.to_string());
    state.recent_projects.truncate(MAX_RECENT);
    save_state(dir, &state)?;
    Ok(state.recent_projects)
}

pub fn get_recent_impl(dir: &Path) -> Vec<String> {
    load_state(dir).recent_projects
}

/// FNV-1a 64-bit hash of the normalized path, as 16 hex chars.
pub fn window_hash(path: &str) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in path_key(path).bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{h:016x}")
}

pub fn window_label(path: &str) -> String {
    format!("proj-{}", window_hash(path))
}

fn urlencode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

pub fn project_url(path: &str) -> String {
    format!("index.html?project={}", urlencode(path))
}

// ---------- tauri glue ----------

pub fn config_dir() -> PathBuf {
    // app_config_dir() would map to %APPDATA%/<bundle identifier>, not %APPDATA%/Ideal.
    let base = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("Ideal")
}

#[tauri::command(async)]
pub fn get_settings() -> SettingsWithWarning {
    load(&config_dir())
}

/// Path of settings.json; creates it from the bundled defaults if missing.
pub fn ensure_settings_file(dir: &Path) -> Result<PathBuf, String> {
    std::fs::create_dir_all(dir).map_err(err)?;
    let path = dir.join("settings.json");
    match std::fs::OpenOptions::new().write(true).create_new(true).open(&path) {
        Ok(mut f) => {
            f.write_all(DEFAULTS_JSON.as_bytes()).map_err(err)?;
            f.sync_all().map_err(err)?;
        }
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(e) => return Err(err(e)),
    }
    Ok(path)
}

/// Sets `theme` in settings.json; the watcher then tells every window.
pub fn set_theme_impl(dir: &Path, theme: &str) -> Result<(), String> {
    let path = ensure_settings_file(dir)?;
    let text = std::fs::read_to_string(&path).map_err(err)?;
    let mut json: Value = serde_json::from_str(&text).map_err(|e| format!("settings.json non valido: {e}"))?;
    let Some(obj) = json.as_object_mut() else {
        return Err("settings.json non valido: non è un oggetto".into());
    };
    obj.insert("theme".into(), Value::String(theme.into()));
    let out = serde_json::to_string_pretty(&json).map_err(err)?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, out).map_err(err)?;
    std::fs::rename(&tmp, &path).map_err(err)
}

#[tauri::command(async)]
pub fn set_theme(theme: String) -> Result<(), String> {
    set_theme_impl(&config_dir(), &theme)
}

/// `#rrggbb` to the 0x00BBGGRR value DWM wants.
fn colorref(hex: &str) -> Option<u32> {
    let h = hex.strip_prefix('#').filter(|h| h.len() == 6)?;
    let v = u32::from_str_radix(h, 16).ok()?;
    Some(((v & 0xff) << 16) | (v & 0xff00) | (v >> 16))
}

/// Tints the native title bar. Windows 11 only: older systems reject the attribute, which is fine.
#[tauri::command]
pub fn set_window_chrome(window: tauri::WebviewWindow, caption: String, text: String) -> Result<(), String> {
    let (Some(caption), Some(text)) = (colorref(&caption), colorref(&text)) else {
        return Err("colore non valido".into());
    };
    #[cfg(windows)]
    {
        use windows_sys::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_CAPTION_COLOR, DWMWA_TEXT_COLOR};
        let hwnd = window.hwnd().map_err(err)?.0 as windows_sys::Win32::Foundation::HWND;
        for (attr, value) in [(DWMWA_CAPTION_COLOR, caption), (DWMWA_TEXT_COLOR, text)] {
            // SAFETY: hwnd is this live window; the pointer and size describe a local u32.
            unsafe {
                DwmSetWindowAttribute(hwnd, attr as u32, (&raw const value).cast(), size_of::<u32>() as u32);
            }
        }
    }
    #[cfg(not(windows))]
    let _ = (window, caption, text);
    Ok(())
}

#[tauri::command(async)]
pub fn settings_path() -> Result<String, String> {
    ensure_settings_file(&config_dir()).map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command(async)]
pub fn get_recent() -> Vec<String> {
    get_recent_impl(&config_dir())
}

#[tauri::command(async)]
pub fn add_recent(path: String) -> Result<Vec<String>, String> {
    add_recent_impl(&config_dir(), &path)
}

fn check_is_dir(path: &str) -> Result<(), String> {
    if std::path::Path::new(path).is_dir() {
        Ok(())
    } else {
        Err("non è una cartella".to_string())
    }
}

#[tauri::command(async)]
pub fn open_project_window(app: AppHandle, path: String) -> Result<(), String> {
    check_is_dir(&path)?;
    let label = window_label(&path);
    // Best effort: failing to record the recent entry must not block opening.
    let _ = add_recent_impl(&config_dir(), &path);
    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.unminimize();
        return w.set_focus().map_err(err);
    }
    match WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(project_url(&path).into()))
        .title("Ideal")
        .inner_size(1280.0, 800.0)
        .min_inner_size(760.0, 480.0)
        .build()
    {
        Ok(_) => Ok(()),
        Err(e) => match app.get_webview_window(&label) {
            // Lost a race with another open of the same project: focus the winner.
            Some(w) => w.set_focus().map_err(err),
            None => Err(err(e)),
        },
    }
}

/// Watch settings.json and emit `settings://changed`. Blocks on a channel (no polling).
pub fn start_watcher(app: AppHandle) {
    let dir = config_dir();
    if let Err(e) = std::fs::create_dir_all(&dir) {
        eprintln!("watcher settings: impossibile creare {}: {e}", dir.display());
        return;
    }
    let (tx, rx) = mpsc::channel::<()>();
    let name = std::ffi::OsString::from("settings.json");
    let watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(ev) = res {
            if ev.paths.iter().any(|p| p.file_name() == Some(name.as_os_str())) {
                let _ = tx.send(());
            }
        }
    });
    let mut watcher = match watcher {
        Ok(w) => w,
        Err(e) => {
            eprintln!("watcher settings: creazione fallita: {e}");
            return;
        }
    };
    if let Err(e) = watcher.watch(&dir, RecursiveMode::NonRecursive) {
        eprintln!("watcher settings: watch fallito su {}: {e}", dir.display());
        return;
    }
    std::thread::spawn(move || {
        let _watcher = watcher; // keep alive
        while rx.recv().is_ok() {
            // Debounce: wait until 200 ms pass without new events.
            while rx.recv_timeout(DEBOUNCE).is_ok() {}
            let _ = app.emit("settings://changed", load(&dir));
        }
    });
}

#[cfg(test)]
mod tests {
    #[test]
    fn check_is_dir_rejects_files_and_missing() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("a.txt");
        std::fs::write(&f, "x").unwrap();
        assert!(super::check_is_dir(dir.path().to_str().unwrap()).is_ok());
        assert!(super::check_is_dir(f.to_str().unwrap()).is_err());
        assert!(super::check_is_dir(r"C:\nope\missing").is_err());
    }

    use super::*;
    use std::fs;

    fn tmp() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    #[test]
    fn load_missing_file_gives_defaults() {
        let d = tmp();
        let r = load(d.path());
        assert_eq!(r.settings, Settings::default());
        assert!(r.warning.is_none());
        assert_eq!(r.settings.editor.font_size, 14);
        assert_eq!(r.settings.claude_mem.port, 37777);
    }

    #[test]
    fn load_partial_merges() {
        let d = tmp();
        fs::write(d.path().join("settings.json"), r#"{"editor":{"fontSize":18}}"#).unwrap();
        let r = load(d.path());
        assert!(r.warning.is_none());
        assert_eq!(r.settings.editor.font_size, 18);
        assert_eq!(r.settings.editor.tab_size, 2);
        assert_eq!(r.settings.terminal.font_size, 13);
    }

    #[test]
    fn load_invalid_json_warns() {
        let d = tmp();
        fs::write(d.path().join("settings.json"), "{ not json").unwrap();
        let r = load(d.path());
        assert_eq!(r.settings, Settings::default());
        assert!(r.warning.is_some());
    }

    #[test]
    fn load_ignores_unknown_keys_and_wrong_types_warn() {
        let d = tmp();
        fs::write(d.path().join("settings.json"), r#"{"zzz":1,"theme":"x"}"#).unwrap();
        let r = load(d.path());
        assert_eq!(r.settings.theme, "x");
        assert!(r.warning.is_none());
        fs::write(d.path().join("settings.json"), r#"{"editor":{"tabSize":"a"}}"#).unwrap();
        assert!(load(d.path()).warning.is_some());
    }

    #[test]
    fn ensure_settings_file_creates_from_defaults_once() {
        let d = tmp();
        let p = ensure_settings_file(d.path()).unwrap();
        assert_eq!(fs::read_to_string(&p).unwrap(), DEFAULTS_JSON);
        fs::write(&p, "{}").unwrap();
        ensure_settings_file(d.path()).unwrap();
        assert_eq!(fs::read_to_string(&p).unwrap(), "{}");
    }

    #[test]
    fn corrupt_state_is_backed_up() {
        let d = tmp();
        fs::write(d.path().join("state.json"), "{ broken").unwrap();
        assert_eq!(load_state(d.path()), AppState::default());
        assert_eq!(fs::read_to_string(d.path().join("state.json.bad")).unwrap(), "{ broken");
        assert!(!d.path().join("state.json").exists());
    }

    #[test]
    fn colorref_swaps_red_and_blue() {
        assert_eq!(colorref("#112233"), Some(0x0033_2211));
        assert_eq!(colorref("112233"), None);
        assert_eq!(colorref("#12"), None);
    }

    #[test]
    fn set_theme_keeps_other_keys() {
        let d = tmp();
        std::fs::write(d.path().join("settings.json"), r#"{"editor":{"fontSize":20},"lsp":{"rust":false}}"#).unwrap();
        set_theme_impl(d.path(), "bosco").unwrap();
        let v: Value = serde_json::from_str(&std::fs::read_to_string(d.path().join("settings.json")).unwrap()).unwrap();
        assert_eq!(v["theme"], "bosco");
        assert_eq!(v["editor"]["fontSize"], 20);
        assert_eq!(v["lsp"]["rust"], false);
    }

    #[test]
    fn set_theme_refuses_invalid_json_without_touching_it() {
        let d = tmp();
        let p = d.path().join("settings.json");
        std::fs::write(&p, "{ rotto").unwrap();
        assert!(set_theme_impl(d.path(), "bosco").is_err());
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "{ rotto");
    }

    #[test]
    fn deep_merge_nested_array_and_null() {
        let mut base = serde_json::json!({"a":{"b":1,"c":2},"arr":[1,2,3],"s":"x"});
        deep_merge(&mut base, serde_json::json!({"a":{"b":9},"arr":[4],"s":null}));
        assert_eq!(base, serde_json::json!({"a":{"b":9,"c":2},"arr":[4],"s":null}));

        let d = tmp();
        fs::write(d.path().join("settings.json"), r#"{"terminal":{"shell":null}}"#).unwrap();
        let r = load(d.path());
        assert!(r.warning.is_none());
        assert_eq!(r.settings.terminal.shell, None);
        assert_eq!(r.settings.terminal.font_size, 13);
    }

    #[test]
    fn defaults_json_matches_default_impl() {
        assert_eq!(merged(serde_json::json!({})).unwrap(), Settings::default());
    }

    #[test]
    fn recent_dedup_and_cap() {
        let d = tmp();
        for i in 0..12 {
            add_recent_impl(d.path(), &format!("C:\\p{i}")).unwrap();
        }
        // duplicate of an existing (different case/separator) moves to front
        add_recent_impl(d.path(), "c:/P5").unwrap();
        let r = get_recent_impl(d.path());
        assert_eq!(r.len(), 10);
        assert_eq!(r[0], "c:/P5");
        assert_eq!(r.iter().filter(|p| path_key(p) == "c:/p5").count(), 1);
        assert_eq!(r[1], "C:\\p11");
    }

    #[test]
    fn window_label_stable_and_valid() {
        let a = window_label("C:\\Proj\\A\\");
        assert_eq!(a, window_label("c:/proj/a"));
        assert_ne!(a, window_label("c:/proj/b"));
        assert!(a.starts_with("proj-"));
        assert!(a.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'));
    }

    #[test]
    fn project_url_encodes() {
        assert_eq!(project_url("C:\\a b"), "index.html?project=C%3A%5Ca%20b");
    }

    #[test]
    fn state_roundtrip_with_layout() {
        let d = tmp();
        let mut s = AppState::default();
        s.layout.insert("c:/a".into(), LayoutState { sidebar_width: Some(300), panel_height: None });
        save_state(d.path(), &s).unwrap();
        assert_eq!(load_state(d.path()), s);
    }
}
