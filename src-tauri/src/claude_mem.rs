use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::time::Duration;

const DOWN: &str = "claude-mem non attivo";

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MemObservation {
    pub id: i64,
    pub project: String,
    pub kind: String,
    pub title: String,
    pub subtitle: Option<String>,
    pub narrative: Option<String>,
    pub facts: Vec<String>,
    pub files_modified: Vec<String>,
    pub created_at_epoch: i64,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MemSummary {
    pub id: i64,
    pub request: Option<String>,
    pub investigated: Option<String>,
    pub learned: Option<String>,
    pub completed: Option<String>,
    pub next_steps: Option<String>,
    pub created_at_epoch: i64,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MemPage<T> {
    pub items: Vec<T>,
    pub has_more: bool,
}

#[derive(Deserialize)]
struct RawObs {
    id: i64,
    #[serde(default)]
    project: String,
    #[serde(default, rename = "type")]
    kind: String,
    #[serde(default)]
    title: Option<String>,
    subtitle: Option<String>,
    narrative: Option<String>,
    facts: Option<String>,
    files_modified: Option<String>,
    #[serde(default)]
    created_at_epoch: i64,
}

#[derive(Deserialize)]
struct RawSummary {
    id: i64,
    request: Option<String>,
    investigated: Option<String>,
    learned: Option<String>,
    completed: Option<String>,
    next_steps: Option<String>,
    #[serde(default)]
    created_at_epoch: i64,
}

#[derive(Deserialize)]
struct RawPage<T> {
    #[serde(default = "Vec::new")]
    items: Vec<T>,
    #[serde(default, rename = "hasMore")]
    has_more: bool,
}

fn decode_list(s: &Option<String>) -> Vec<String> {
    s.as_deref()
        .and_then(|t| serde_json::from_str::<Vec<String>>(t).ok())
        .unwrap_or_default()
}

pub fn parse_observations(json: &str) -> Result<MemPage<MemObservation>, String> {
    let raw: RawPage<RawObs> = serde_json::from_str(json).map_err(|e| e.to_string())?;
    Ok(MemPage {
        has_more: raw.has_more,
        items: raw
            .items
            .into_iter()
            .map(|o| MemObservation {
                id: o.id,
                project: o.project,
                kind: o.kind,
                title: o.title.unwrap_or_default(),
                subtitle: o.subtitle,
                narrative: o.narrative,
                facts: decode_list(&o.facts),
                files_modified: decode_list(&o.files_modified),
                created_at_epoch: o.created_at_epoch,
            })
            .collect(),
    })
}

pub fn parse_summaries(json: &str) -> Result<MemPage<MemSummary>, String> {
    let raw: RawPage<RawSummary> = serde_json::from_str(json).map_err(|e| e.to_string())?;
    Ok(MemPage {
        has_more: raw.has_more,
        items: raw
            .items
            .into_iter()
            .map(|s| MemSummary {
                id: s.id,
                request: s.request,
                investigated: s.investigated,
                learned: s.learned,
                completed: s.completed,
                next_steps: s.next_steps,
                created_at_epoch: s.created_at_epoch,
            })
            .collect(),
    })
}

fn parse_semver(s: &str) -> Option<(u64, u64, u64)> {
    let mut it = s.split('.');
    let v = (
        it.next()?.parse().ok()?,
        it.next()?.parse().ok()?,
        it.next()?.parse().ok()?,
    );
    if it.next().is_some() { None } else { Some(v) }
}

pub fn newest_version_dir(base: &Path) -> Option<PathBuf> {
    std::fs::read_dir(base)
        .ok()?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .filter_map(|e| {
            let v = parse_semver(e.file_name().to_str()?)?;
            Some((v, e.path()))
        })
        .max_by_key(|(v, _)| *v)
        .map(|(_, p)| p)
}

fn get_text(port: u16, path: &str, query: &[(&str, &str)]) -> Result<String, String> {
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(3))
        .timeout(Duration::from_secs(3))
        .redirects(0)
        .build();
    let mut req = agent.get(&format!("http://127.0.0.1:{port}{path}"));
    for (k, v) in query {
        req = req.query(k, v);
    }
    let resp = req.call().map_err(|e| match e {
        ureq::Error::Status(code, _) => format!("claude-mem errore HTTP {code}"),
        _ => DOWN.to_string(),
    })?;
    if !(200..300).contains(&resp.status()) {
        return Err(format!("claude-mem errore HTTP {}", resp.status()));
    }
    resp.into_string().map_err(|_| DOWN.to_string())
}

pub fn health_impl(port: u16) -> Result<bool, String> {
    let t = get_text(port, "/api/health", &[])?;
    let v: Value = serde_json::from_str(&t).map_err(|_| DOWN.to_string())?;
    Ok(v.get("status").and_then(Value::as_str) == Some("ok"))
}

fn paged_query<'a>(project: &'a str, offset: &'a str, limit: &'a str) -> [(&'a str, &'a str); 3] {
    [("project", project), ("offset", offset), ("limit", limit)]
}

pub fn observations_impl(
    port: u16,
    project: &str,
    offset: u32,
    limit: u32,
) -> Result<MemPage<MemObservation>, String> {
    let (o, l) = (offset.to_string(), limit.to_string());
    parse_observations(&get_text(port, "/api/observations", &paged_query(project, &o, &l))?)
}

pub fn summaries_impl(
    port: u16,
    project: &str,
    offset: u32,
    limit: u32,
) -> Result<MemPage<MemSummary>, String> {
    let (o, l) = (offset.to_string(), limit.to_string());
    parse_summaries(&get_text(port, "/api/summaries", &paged_query(project, &o, &l))?)
}

pub fn search_impl(port: u16, project: &str, query: &str) -> Result<String, String> {
    let t = get_text(port, "/api/search", &[("query", query), ("project", project)])?;
    let v: Value = serde_json::from_str(&t).map_err(|_| "risposta di claude-mem non valida".to_string())?;
    Ok(v["content"][0]["text"].as_str().unwrap_or_default().to_string())
}

pub fn start_worker_impl(base: &Path) -> Result<(), String> {
    let dir = newest_version_dir(base).ok_or("claude-mem non installato")?;
    let scripts = dir.join("scripts");
    let mut cmd = std::process::Command::new("node");
    cmd.arg(scripts.join("bun-runner.js"))
        .arg(scripts.join("worker-service.cjs"))
        .arg("start")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP
        cmd.creation_flags(0x0800_0000 | 0x0000_0200);
    }
    cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn mem_health(port: u16) -> Result<bool, String> {
    health_impl(port)
}

#[tauri::command(async)]
pub fn mem_observations(
    port: u16,
    project: String,
    offset: u32,
    limit: u32,
) -> Result<MemPage<MemObservation>, String> {
    observations_impl(port, &project, offset, limit)
}

#[tauri::command(async)]
pub fn mem_summaries(
    port: u16,
    project: String,
    offset: u32,
    limit: u32,
) -> Result<MemPage<MemSummary>, String> {
    summaries_impl(port, &project, offset, limit)
}

#[tauri::command(async)]
pub fn mem_search(port: u16, project: String, query: String) -> Result<String, String> {
    search_impl(port, &project, &query)
}

#[tauri::command(async)]
pub fn mem_start_worker() -> Result<(), String> {
    let home = std::env::var_os("USERPROFILE").ok_or("claude-mem non installato")?;
    let base = PathBuf::from(home)
        .join(".claude")
        .join("plugins")
        .join("cache")
        .join("thedotmack")
        .join("claude-mem");
    start_worker_impl(&base)
}

/// Only the local claude-mem worker UI may be opened: exactly http://127.0.0.1:<port>/... or http://localhost:<port>/...
pub fn allowed_url(url: &str, port: u16) -> bool {
    if url.chars().any(|c| c.is_control() || c.is_whitespace() || matches!(c, '"' | '\'' | '`' | '^' | '&' | '|' | '<' | '>' | '%' | '\\')) {
        return false;
    }
    for host in ["127.0.0.1", "localhost"] {
        let prefix = format!("http://{host}:{port}");
        if let Some(rest) = url.strip_prefix(&prefix) {
            return rest.is_empty() || rest.starts_with('/') || rest.starts_with('?') || rest.starts_with('#');
        }
    }
    false
}

#[tauri::command(async)]
pub fn open_in_browser(url: String, port: u16) -> Result<(), String> {
    if !allowed_url(&url, port) {
        return Err("URL non consentito".into());
    }
    let mut cmd = std::process::Command::new("explorer");
    cmd.arg(&url);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    // explorer.exe returns a non-zero exit code even on success; only spawn errors matter.
    cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    #[test]
    fn allowed_url_guard() {
        let ok = ["http://127.0.0.1:37777/", "http://localhost:37777/viewer", "http://127.0.0.1:37777", "http://localhost:37777/?a=1#x"];
        for u in ok {
            assert!(allowed_url(u, 37777), "{u}");
        }
        let bad = [
            "http://127.0.0.1:37778/",
            "http://127.0.0.1:377770/",
            "http://127.0.0.1:37777@evil.com/",
            "http://user@127.0.0.1:37777/",
            "https://127.0.0.1:37777/",
            "http://evil.com:37777/",
            "http://localhost.evil.com:37777/",
            "http://127.0.0.1:37777.evil.com/",
            "http://127.0.0.1:37777/\"x",
            "http://127.0.0.1:37777/ x",
            "http://127.0.0.1:37777/
x",
            "http://127.0.0.1:37777/a\"b",
            "http://127.0.0.1:37777/a&calc",
            "http://127.0.0.1:37777/a%22b",
            "file:///c:/windows",
            "",
        ];
        for u in bad {
            assert!(!allowed_url(u, 37777), "{u}");
        }
    }

    const FIXTURE: &str = r#"{"items":[{"id":7,"memory_session_id":"s","project":"Ideal","merged_into_project":null,"platform_source":"claude","type":"decision","title":"T","subtitle":null,"narrative":"N","text":"x","facts":"[\"a\",\"b\"]","concepts":"[]","files_read":"[]","files_modified":"[\"src/a.rs\"]","prompt_number":1,"created_at":"2026-10-31","created_at_epoch":1761900000}],"hasMore":true,"offset":0,"limit":1}"#;

    #[test]
    fn parse_observations_decodes_json_string_fields() {
        let p = parse_observations(FIXTURE).unwrap();
        assert!(p.has_more);
        let o = &p.items[0];
        assert_eq!(o.id, 7);
        assert_eq!(o.kind, "decision");
        assert_eq!(o.facts, vec!["a", "b"]);
        assert_eq!(o.files_modified, vec!["src/a.rs"]);
        assert_eq!(o.subtitle, None);
        assert_eq!(o.narrative.as_deref(), Some("N"));
        assert_eq!(o.created_at_epoch, 1761900000);
    }

    #[test]
    fn parse_bad_facts_empty() {
        let j = r#"{"items":[{"id":1,"project":"P","type":"t","title":"T","facts":"not json","files_modified":null,"created_at_epoch":1}],"hasMore":false}"#;
        let p = parse_observations(j).unwrap();
        assert!(p.items[0].facts.is_empty());
        assert!(p.items[0].files_modified.is_empty());
    }

    #[test]
    fn parse_summaries_basic() {
        let j = r#"{"items":[{"id":2,"request":"r","investigated":null,"learned":"l","completed":null,"next_steps":"n","created_at_epoch":5}],"hasMore":false}"#;
        let p = parse_summaries(j).unwrap();
        assert_eq!(p.items[0].next_steps.as_deref(), Some("n"));
        assert_eq!(p.items[0].request.as_deref(), Some("r"));
        assert_eq!(p.items[0].learned.as_deref(), Some("l"));
    }

    #[test]
    fn newest_version_dir_semver() {
        let d = tempfile::tempdir().unwrap();
        for n in ["13.9.0", "13.12.4", "notes"] {
            std::fs::create_dir(d.path().join(n)).unwrap();
        }
        let got = newest_version_dir(d.path()).unwrap();
        assert_eq!(got.file_name().unwrap(), "13.12.4");
        assert!(newest_version_dir(&d.path().join("missing")).is_none());
    }

    #[test]
    fn start_worker_not_installed() {
        let d = tempfile::tempdir().unwrap();
        assert_eq!(start_worker_impl(d.path()).unwrap_err(), "claude-mem non installato");
    }

    #[test]
    fn mem_health_down_port_errs_fast() {
        let port = {
            let l = TcpListener::bind("127.0.0.1:0").unwrap();
            l.local_addr().unwrap().port()
        };
        let t = std::time::Instant::now();
        assert_eq!(mem_health(port).unwrap_err(), "claude-mem non attivo");
        assert!(t.elapsed() < Duration::from_secs(4));
    }

    fn stub(body: &'static str) -> (u16, std::thread::JoinHandle<String>) {
        stub_status("200 OK", body)
    }

    fn stub_status(status: &'static str, body: &'static str) -> (u16, std::thread::JoinHandle<String>) {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        let h = std::thread::spawn(move || {
            let (mut s, _) = l.accept().unwrap();
            let mut buf = [0u8; 4096];
            let n = s.read(&mut buf).unwrap();
            let req = String::from_utf8_lossy(&buf[..n]).to_string();
            let resp = format!(
                "HTTP/1.1 {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                status,
                body.len(),
                body
            );
            s.write_all(resp.as_bytes()).unwrap();
            req.lines().next().unwrap_or_default().to_string()
        });
        (port, h)
    }

    #[test]
    fn mem_observations_against_stub_server() {
        let (port, h) = stub(FIXTURE);
        let p = observations_impl(port, "My Proj", 5, 20).unwrap();
        assert_eq!(p.items[0].facts, vec!["a", "b"]);
        let line = h.join().unwrap();
        assert!(line.starts_with("GET /api/observations?"), "{line}");
        assert!(line.contains("project=My%20Proj") || line.contains("project=My+Proj"), "{line}");
        assert!(line.contains("offset=5") && line.contains("limit=20"), "{line}");
    }

    #[test]
    fn mem_search_returns_markdown_text() {
        let (port, h) = stub(r##"{"content":[{"type":"text","text":"# Hit"}]}"##);
        assert_eq!(search_impl(port, "P", "a b").unwrap(), "# Hit");
        let line = h.join().unwrap();
        assert!(line.contains("query=a%20b") || line.contains("query=a+b"), "{line}");
    }

    #[test]
    fn http_status_error_is_not_down() {
        let (port, _h) = stub_status("500 Internal Server Error", "{}");
        assert_eq!(health_impl(port).unwrap_err(), "claude-mem errore HTTP 500");
    }

    #[test]
    fn search_bad_json_italian_error() {
        let (port, _h) = stub("not json");
        assert_eq!(search_impl(port, "P", "q").unwrap_err(), "risposta di claude-mem non valida");
    }

    #[test]
    fn redirect_not_followed() {
        let (port, _h) = stub_status("302 Found", r#"{"status":"ok"}"#);
        assert_eq!(health_impl(port).unwrap_err(), "claude-mem errore HTTP 302");
    }

    #[test]
    fn mem_health_ok_against_stub() {
        let (port, _h) = stub(r#"{"status":"ok","version":"13.12.4"}"#);
        assert_eq!(health_impl(port), Ok(true));
    }
}
