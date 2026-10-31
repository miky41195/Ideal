use serde::Serialize;
use serde_json::{Map, Value};
use std::io::Write;
use std::path::{Path, PathBuf};

const ALLOWED_KEYS: [&str; 2] = ["claude-mem@thedotmack", "caveman@caveman"];
const INVALID: &str = "settings.json di Claude non valido";

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginStatus {
    pub claude_mem: bool,
    pub caveman: bool,
}

pub fn plugins_status_impl(settings_path: &Path) -> Result<PluginStatus, String> {
    let text = match std::fs::read_to_string(settings_path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(PluginStatus { claude_mem: false, caveman: false });
        }
        Err(e) => return Err(e.to_string()),
    };
    let v: Value = serde_json::from_str(&text).map_err(|_| INVALID.to_string())?;
    let on = |k: &str| {
        v.get("enabledPlugins")
            .and_then(|p| p.get(k))
            .and_then(Value::as_bool)
            .unwrap_or(false)
    };
    Ok(PluginStatus { claude_mem: on("claude-mem@thedotmack"), caveman: on("caveman@caveman") })
}

pub fn plugin_enable_impl(settings_path: &Path, key: &str) -> Result<(), String> {
    if !ALLOWED_KEYS.contains(&key) {
        return Err("plugin non supportato".into());
    }
    let text = std::fs::read_to_string(settings_path)
        .map_err(|_| "settings.json di Claude non trovato".to_string())?;
    let mut v: Value = serde_json::from_str(&text).map_err(|_| INVALID.to_string())?;
    let root = v.as_object_mut().ok_or(INVALID)?;
    let plugins = root
        .entry("enabledPlugins")
        .or_insert_with(|| Value::Object(Map::new()));
    let plugins = plugins.as_object_mut().ok_or(INVALID)?;
    plugins.insert(key.to_string(), Value::Bool(true));

    let mut out = serde_json::to_string_pretty(&v).map_err(|e| e.to_string())?;
    out.push('\n');
    let dir = settings_path.parent().unwrap_or(Path::new("."));
    let mut tmp = tempfile::NamedTempFile::new_in(dir).map_err(|e| e.to_string())?;
    tmp.write_all(out.as_bytes()).map_err(|e| e.to_string())?;
    tmp.persist(settings_path).map_err(|e| e.error.to_string())?;
    Ok(())
}

fn claude_settings_path() -> Result<PathBuf, String> {
    let home = std::env::var_os("USERPROFILE").ok_or("home non trovata")?;
    Ok(PathBuf::from(home).join(".claude").join("settings.json"))
}

#[tauri::command(async)]
pub fn plugins_status() -> Result<PluginStatus, String> {
    plugins_status_impl(&claude_settings_path()?)
}

#[tauri::command(async)]
pub fn plugin_enable(key: String) -> Result<(), String> {
    plugin_enable_impl(&claude_settings_path()?, &key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plugins_status_missing_file() {
        let d = tempfile::tempdir().unwrap();
        let s = plugins_status_impl(&d.path().join("nope.json")).unwrap();
        assert_eq!(s, PluginStatus { claude_mem: false, caveman: false });
    }

    #[test]
    fn plugin_enable_preserves_other_keys_and_order() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("settings.json");
        std::fs::write(
            &p,
            r#"{"model":"x","enabledPlugins":{"a":true,"claude-mem@thedotmack":false},"z":1}"#,
        )
        .unwrap();
        plugin_enable_impl(&p, "claude-mem@thedotmack").unwrap();
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&p).unwrap()).unwrap();
        let top: Vec<&String> = v.as_object().unwrap().keys().collect();
        assert_eq!(top, ["model", "enabledPlugins", "z"]);
        let pl = v["enabledPlugins"].as_object().unwrap();
        let inner: Vec<&String> = pl.keys().collect();
        assert_eq!(inner, ["a", "claude-mem@thedotmack"]);
        assert_eq!(pl["a"], true);
        assert_eq!(pl["claude-mem@thedotmack"], true);
        assert_eq!(v["model"], "x");
        assert_eq!(v["z"], 1);
        assert!(plugins_status_impl(&p).unwrap().claude_mem);
    }

    #[test]
    fn plugin_enable_creates_enabled_plugins() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("settings.json");
        std::fs::write(&p, r#"{"model":"x"}"#).unwrap();
        plugin_enable_impl(&p, "caveman@caveman").unwrap();
        assert!(plugins_status_impl(&p).unwrap().caveman);
    }

    #[test]
    fn plugin_enable_rejects_unknown_key() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("settings.json");
        std::fs::write(&p, "{}").unwrap();
        assert!(plugin_enable_impl(&p, "evil@x").is_err());
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "{}");
    }

    #[test]
    fn plugin_enable_invalid_json_untouched() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("settings.json");
        std::fs::write(&p, "{ not json").unwrap();
        let e = plugin_enable_impl(&p, "caveman@caveman").unwrap_err();
        assert_eq!(e, INVALID);
        assert_eq!(std::fs::read(&p).unwrap(), b"{ not json");
    }
}
