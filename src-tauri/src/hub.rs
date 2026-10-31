use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::SystemTime;

const NO_TITLE: &str = "Sessione senza titolo";

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionMeta {
    pub id: String,
    pub title: String,
    pub started: i64,
    pub updated: i64,
    pub entries: u32,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptEntry {
    pub kind: String,
    pub text: String,
    pub tool: Option<String>,
    pub ts: i64,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptPage {
    pub entries: Vec<TranscriptEntry>,
    pub total: u32,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MdFile {
    pub name: String,
    pub path: String,
    pub updated: i64,
}

/// Per-file listing cache keyed by path, validated against (mtime, len).
#[derive(Default)]
pub struct SessionCache {
    map: Mutex<HashMap<PathBuf, (SystemTime, u64, SessionMeta)>>,
    scans: AtomicUsize,
}

pub fn project_slug(path: &str) -> String {
    path.chars()
        .map(|c| if matches!(c, ':' | '\\' | '/') { '-' } else { c })
        .collect()
}

pub fn find_project_dir(claude_projects: &Path, project_path: &str) -> Option<PathBuf> {
    let slug = project_slug(project_path);
    std::fs::read_dir(claude_projects)
        .ok()?
        .filter_map(|e| e.ok())
        .find(|e| e.path().is_dir() && e.file_name().to_string_lossy().eq_ignore_ascii_case(&slug))
        .map(|e| e.path())
}

// ---------- time ----------

fn systime_ms(t: SystemTime) -> i64 {
    t.duration_since(SystemTime::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// "2026-10-31T12:34:56.789Z" -> epoch ms.
fn parse_iso_ms(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    if b.len() < 19 {
        return None;
    }
    let n = |r: std::ops::Range<usize>| s.get(r)?.parse::<i64>().ok();
    let (y, mo, d) = (n(0..4)?, n(5..7)?, n(8..10)?);
    let (h, mi, se) = (n(11..13)?, n(14..16)?, n(17..19)?);
    let ms = if b.len() > 20 && b[19] == b'.' {
        let frac: String = s[20..].chars().take_while(|c| c.is_ascii_digit()).take(3).collect();
        format!("{frac:0<3}").parse::<i64>().ok()?
    } else {
        0
    };
    // days from civil (Howard Hinnant)
    let y2 = if mo <= 2 { y - 1 } else { y };
    let era = y2.div_euclid(400);
    let yoe = y2 - era * 400;
    let doy = (153 * (if mo > 2 { mo - 3 } else { mo + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe - 719468;
    Some(((days * 24 + h) * 60 + mi) * 60_000 + se * 1000 + ms)
}

/// Cheap timestamp extraction without parsing the whole line.
fn quick_ts(line: &str) -> Option<i64> {
    let i = line.find("\"timestamp\":\"")? + 13;
    let rest = line.get(i..)?;
    parse_iso_ms(rest.split('"').next()?)
}

// ---------- line helpers ----------

fn is_entry_line(line: &str) -> bool {
    line.contains("\"type\":\"user\"") || line.contains("\"type\":\"assistant\"")
}

fn trunc_chars(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

fn text_of_blocks(blocks: &[Value]) -> String {
    blocks
        .iter()
        .filter(|b| b["type"] == "text")
        .filter_map(|b| b["text"].as_str())
        .collect::<Vec<_>>()
        .join("\n")
}

fn user_prompt(v: &Value) -> Option<String> {
    if v["type"] != "user" {
        return None;
    }
    let t = match &v["message"]["content"] {
        Value::String(s) => s.clone(),
        Value::Array(a) => text_of_blocks(a),
        _ => return None,
    };
    let t = t.trim();
    if t.is_empty() { None } else { Some(t.to_string()) }
}

fn scan_session(path: &Path, id: &str, mtime: SystemTime) -> SessionMeta {
    let updated = systime_ms(mtime);
    let mut ai_title: Option<String> = None;
    let mut first_prompt: Option<String> = None;
    let mut started: Option<i64> = None;
    let mut entries = 0u32;
    if let Ok(f) = std::fs::File::open(path) {
        let mut r = BufReader::new(f);
        let mut buf = Vec::new();
        loop {
            buf.clear();
            match r.read_until(b'\n', &mut buf) {
                Ok(0) | Err(_) => break,
                Ok(_) => {}
            }
            let line = String::from_utf8_lossy(&buf);
            if line.contains("\"type\":\"ai-title\"") {
                if let Ok(v) = serde_json::from_str::<Value>(line.trim()) {
                    let t = v["aiTitle"].as_str().or_else(|| v["title"].as_str());
                    if let Some(t) = t.map(str::trim).filter(|t| !t.is_empty()) {
                        ai_title = Some(t.to_string());
                    }
                }
            } else if is_entry_line(&line) {
                entries += 1;
                if started.is_none() {
                    started = quick_ts(&line);
                }
                if first_prompt.is_none() && line.contains("\"type\":\"user\"") {
                    if let Ok(v) = serde_json::from_str::<Value>(line.trim()) {
                        first_prompt = user_prompt(&v);
                    }
                }
            }
        }
    }
    let title = ai_title
        .or_else(|| first_prompt.map(|p| trunc_chars(&p, 80)))
        .unwrap_or_else(|| NO_TITLE.to_string());
    SessionMeta { id: id.to_string(), title, started: started.unwrap_or(updated), updated, entries }
}

pub fn sessions_list_impl(
    claude_projects: &Path,
    project_path: &str,
    cache: &SessionCache,
) -> Vec<SessionMeta> {
    let Some(dir) = find_project_dir(claude_projects, project_path) else {
        return vec![];
    };
    let Ok(rd) = std::fs::read_dir(&dir) else { return vec![] };
    let mut out = Vec::new();
    for e in rd.filter_map(|e| e.ok()) {
        let p = e.path();
        if p.extension().and_then(|x| x.to_str()) != Some("jsonl") {
            continue;
        }
        let Some(id) = p.file_stem().and_then(|s| s.to_str()).map(str::to_string) else { continue };
        let Ok(md) = e.metadata() else { continue };
        let (mtime, len) = (md.modified().unwrap_or(SystemTime::UNIX_EPOCH), md.len());
        let hit = cache
            .map
            .lock()
            .unwrap()
            .get(&p)
            .filter(|(m, l, _)| *m == mtime && *l == len)
            .map(|(_, _, meta)| meta.clone());
        let meta = match hit {
            Some(m) => m,
            None => {
                cache.scans.fetch_add(1, Ordering::Relaxed);
                let m = scan_session(&p, &id, mtime);
                cache.map.lock().unwrap().insert(p.clone(), (mtime, len, m.clone()));
                m
            }
        };
        out.push(meta);
    }
    out.sort_by(|a, b| b.updated.cmp(&a.updated));
    out
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

fn line_entries(v: &Value) -> Vec<TranscriptEntry> {
    let ts = v["timestamp"].as_str().and_then(parse_iso_ms).unwrap_or(0);
    let mk = |kind: &str, text: String, tool: Option<String>| TranscriptEntry {
        kind: kind.to_string(),
        text,
        tool,
        ts,
    };
    let c = &v["message"]["content"];
    match v["type"].as_str() {
        Some("user") => {
            let t = match c {
                Value::String(s) => s.clone(),
                Value::Array(a) => text_of_blocks(a),
                _ => String::new(),
            };
            if t.trim().is_empty() { vec![] } else { vec![mk("user", t, None)] }
        }
        Some("assistant") => {
            let Some(blocks) = c.as_array() else {
                return match c.as_str() {
                    Some(s) if !s.trim().is_empty() => vec![mk("assistant", s.to_string(), None)],
                    _ => vec![],
                };
            };
            let mut out = Vec::new();
            let mut texts: Vec<&str> = Vec::new();
            for b in blocks {
                match b["type"].as_str() {
                    Some("text") => {
                        if let Some(t) = b["text"].as_str().filter(|t| !t.trim().is_empty()) {
                            texts.push(t);
                        }
                    }
                    Some("tool_use") => {
                        if !texts.is_empty() {
                            out.push(mk("assistant", texts.join("\n"), None));
                            texts.clear();
                        }
                        let name = b["name"].as_str().unwrap_or("?").to_string();
                        let input = serde_json::to_string(&b["input"]).unwrap_or_default();
                        out.push(mk("tool", trunc_chars(&input, 300), Some(name)));
                    }
                    _ => {}
                }
            }
            if !texts.is_empty() {
                out.push(mk("assistant", texts.join("\n"), None));
            }
            out
        }
        _ => vec![],
    }
}

pub fn session_read_impl(
    claude_projects: &Path,
    project_path: &str,
    id: &str,
    offset: u32,
    limit: u32,
) -> Result<TranscriptPage, String> {
    if !valid_id(id) {
        return Err("id sessione non valido".into());
    }
    let dir = find_project_dir(claude_projects, project_path).ok_or("sessione non trovata")?;
    let f = std::fs::File::open(dir.join(format!("{id}.jsonl")))
        .map_err(|_| "sessione non trovata".to_string())?;
    let mut r = BufReader::new(f);
    let mut buf = Vec::new();
    let (lo, hi) = (offset as u64, offset as u64 + limit as u64);
    let mut idx = 0u64;
    let mut entries = Vec::new();
    loop {
        buf.clear();
        match r.read_until(b'\n', &mut buf) {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
        let line = String::from_utf8_lossy(&buf);
        if !is_entry_line(&line) {
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(line.trim()) else { continue };
        for e in line_entries(&v) {
            if idx >= lo && idx < hi {
                entries.push(e);
            }
            idx += 1;
        }
    }
    Ok(TranscriptPage { entries, total: idx as u32 })
}

// ---------- memories / docs ----------

fn md_files(dir: &Path) -> Vec<MdFile> {
    let Ok(rd) = std::fs::read_dir(dir) else { return vec![] };
    let mut v: Vec<MdFile> = rd
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().and_then(|x| x.to_str()) == Some("md"))
        .filter_map(|e| {
            let md = e.metadata().ok()?;
            md.is_file().then(|| MdFile {
                name: e.file_name().to_string_lossy().into_owned(),
                path: e.path().to_string_lossy().into_owned(),
                updated: systime_ms(md.modified().unwrap_or(SystemTime::UNIX_EPOCH)),
            })
        })
        .collect();
    v.sort_by(|a, b| b.updated.cmp(&a.updated).then_with(|| a.name.cmp(&b.name)));
    v
}

pub fn memories_list_impl(claude_projects: &Path, project_path: &str) -> Vec<MdFile> {
    let Some(dir) = find_project_dir(claude_projects, project_path) else { return vec![] };
    let mut v = md_files(&dir.join("memory"));
    v.sort_by_key(|f| f.name != "MEMORY.md"); // stable: MEMORY.md first, rest newest first
    v
}

pub fn docs_list_impl(project_path: &str) -> Vec<MdFile> {
    let docs = Path::new(project_path).join("docs");
    let mut out = Vec::new();
    let stato = docs.join("STATO-PROGETTO.md");
    if let Ok(md) = std::fs::metadata(&stato) {
        if md.is_file() {
            out.push(MdFile {
                name: "STATO-PROGETTO.md".into(),
                path: stato.to_string_lossy().into_owned(),
                updated: systime_ms(md.modified().unwrap_or(SystemTime::UNIX_EPOCH)),
            });
        }
    }
    out.extend(md_files(&docs.join("superpowers").join("specs")));
    out.extend(md_files(&docs.join("superpowers").join("plans")));
    out
}

fn claude_projects_dir() -> Result<PathBuf, String> {
    let home = std::env::var_os("USERPROFILE").ok_or("home non trovata")?;
    Ok(PathBuf::from(home).join(".claude").join("projects"))
}

#[tauri::command(async)]
pub fn sessions_list(
    project_path: String,
    cache: tauri::State<'_, SessionCache>,
) -> Result<Vec<SessionMeta>, String> {
    Ok(sessions_list_impl(&claude_projects_dir()?, &project_path, &cache))
}

#[tauri::command(async)]
pub fn session_read(
    project_path: String,
    id: String,
    offset: u32,
    limit: u32,
) -> Result<TranscriptPage, String> {
    session_read_impl(&claude_projects_dir()?, &project_path, &id, offset, limit)
}

#[tauri::command(async)]
pub fn memories_list(project_path: String) -> Result<Vec<MdFile>, String> {
    Ok(memories_list_impl(&claude_projects_dir()?, &project_path))
}

#[tauri::command(async)]
pub fn docs_list(project_path: String) -> Vec<MdFile> {
    docs_list_impl(&project_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    const PP: &str = r"C:\Users\x\Proj";

    fn setup() -> (tempfile::TempDir, PathBuf) {
        let d = tempfile::tempdir().unwrap();
        let dir = d.path().join("c--Users-x-Proj");
        fs::create_dir(&dir).unwrap();
        (d, dir)
    }

    fn user(s: &str, ts: &str) -> String {
        format!(
            r#"{{"type":"user","message":{{"role":"user","content":{}}},"timestamp":"{ts}"}}"#,
            serde_json::to_string(s).unwrap()
        )
    }

    #[test]
    fn slug_windows_path() {
        assert_eq!(project_slug(r"C:\Users\miche\Desktop\Ideal"), "C--Users-miche-Desktop-Ideal");
        assert_eq!(project_slug("C:/a/b"), "C--a-b");
    }

    #[test]
    fn find_dir_case_insensitive() {
        let (d, dir) = setup();
        assert_eq!(find_project_dir(d.path(), PP), Some(dir));
        assert_eq!(find_project_dir(d.path(), r"C:\other"), None);
        assert_eq!(find_project_dir(&d.path().join("nope"), PP), None);
    }

    #[test]
    fn list_titles_from_ai_title_then_first_prompt() {
        let (d, dir) = setup();
        let long = "x".repeat(200);
        let a1 = format!(
            "{}\n{}\n{}\n{}\n",
            user("ciao", "2026-10-31T10:00:00.000Z"),
            user("altro", "2026-10-31T10:01:00.000Z"),
            r#"{"type":"ai-title","aiTitle":"Primo"}"#,
            r#"{"type":"ai-title","title":"Ultimo"}"#
        );
        fs::write(dir.join("a1.jsonl"), a1).unwrap();
        fs::write(dir.join("b2.jsonl"), format!("{}\n", user(&long, "2026-10-31T10:00:00.000Z"))).unwrap();
        fs::write(dir.join("c3.jsonl"), "{\"type\":\"system\"}\n").unwrap();
        let l = sessions_list_impl(d.path(), PP, &SessionCache::default());
        let by = |id: &str| l.iter().find(|s| s.id == id).unwrap().clone();
        assert_eq!(by("a1").title, "Ultimo");
        assert_eq!(by("a1").entries, 2);
        assert_eq!(by("a1").started, 1_793_440_800_000);
        assert_eq!(by("b2").title.chars().count(), 80);
        assert_eq!(by("c3").title, "Sessione senza titolo");
    }

    #[test]
    fn iso_parse() {
        assert_eq!(parse_iso_ms("1970-01-01T00:00:01.500Z"), Some(1500));
        assert_eq!(parse_iso_ms("2026-10-31T10:00:00.000Z"), Some(1_793_440_800_000));
        assert_eq!(parse_iso_ms("bad"), None);
    }

    #[test]
    fn list_skips_malformed_and_unknown_lines() {
        let (d, dir) = setup();
        let body = format!(
            "garbage{{{{\n\n{}\n{}\n\u{1}not json\n{}\n",
            r#"{"type":"bridge-session"}"#,
            user("ok", "2026-10-31T10:00:00.000Z"),
            r#"{"type":"ai-title","aiTitle":"#
        );
        fs::write(dir.join("s1.jsonl"), body).unwrap();
        let l = sessions_list_impl(d.path(), PP, &SessionCache::default());
        assert_eq!(l.len(), 1);
        assert_eq!(l[0].title, "ok");
        assert_eq!(l[0].entries, 1);
    }

    #[test]
    fn list_newest_first() {
        let (d, dir) = setup();
        for id in ["old", "new"] {
            fs::write(dir.join(format!("{id}.jsonl")), user(id, "2026-10-31T10:00:00.000Z")).unwrap();
            std::thread::sleep(std::time::Duration::from_millis(30));
        }
        let l = sessions_list_impl(d.path(), PP, &SessionCache::default());
        assert_eq!(l.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(), ["new", "old"]);
    }

    #[test]
    fn list_cache_reused_until_mtime_changes() {
        use std::io::Write;
        let (d, dir) = setup();
        let p = dir.join("s.jsonl");
        fs::write(&p, user("uno", "2026-10-31T10:00:00.000Z") + "\n").unwrap();
        let c = SessionCache::default();
        sessions_list_impl(d.path(), PP, &c);
        sessions_list_impl(d.path(), PP, &c);
        assert_eq!(c.scans.load(Ordering::Relaxed), 1);
        std::thread::sleep(std::time::Duration::from_millis(30));
        let mut f = fs::OpenOptions::new().append(true).open(&p).unwrap();
        writeln!(f, "{}", user("due", "2026-10-31T10:02:00.000Z")).unwrap();
        drop(f);
        let l = sessions_list_impl(d.path(), PP, &c);
        assert_eq!(c.scans.load(Ordering::Relaxed), 2);
        assert_eq!(l[0].entries, 2);
    }

    fn transcript() -> String {
        [
            user("domanda", "2026-10-31T10:00:00.000Z"),
            r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"thinking","thinking":"hmm"}]},"timestamp":"2026-10-31T10:00:01.000Z"}"#.into(),
            r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"ecco"},{"type":"text","text":"ancora"},{"type":"tool_use","name":"Read","input":{"file_path":"a.rs"}}]},"timestamp":"2026-10-31T10:00:02.000Z"}"#.into(),
            r#"{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t","content":"out"}]},"timestamp":"2026-10-31T10:00:03.000Z"}"#.into(),
            r#"{"type":"queue-operation","operation":"enqueue"}"#.into(),
        ]
        .join("\n")
    }

    #[test]
    fn read_maps_kinds_and_skips_thinking_and_tool_results() {
        let (d, dir) = setup();
        fs::write(dir.join("s1.jsonl"), transcript()).unwrap();
        let p = session_read_impl(d.path(), PP, "s1", 0, 100).unwrap();
        let kinds: Vec<_> = p.entries.iter().map(|e| e.kind.as_str()).collect();
        assert_eq!(kinds, ["user", "assistant", "tool"]);
        assert_eq!(p.total, 3);
        assert_eq!(p.entries[1].text, "ecco\nancora");
        assert_eq!(p.entries[2].tool.as_deref(), Some("Read"));
        assert_eq!(p.entries[2].text, r#"{"file_path":"a.rs"}"#);
        assert_eq!(p.entries[0].ts, 1_793_440_800_000);
    }

    #[test]
    fn read_truncates_tool_input() {
        let (d, dir) = setup();
        let big = "y".repeat(1000);
        let line = format!(
            r#"{{"type":"assistant","message":{{"content":[{{"type":"tool_use","name":"Bash","input":{{"command":"{big}"}}}}]}}}}"#
        );
        fs::write(dir.join("s1.jsonl"), line).unwrap();
        let p = session_read_impl(d.path(), PP, "s1", 0, 10).unwrap();
        assert_eq!(p.entries[0].text.chars().count(), 300);
    }

    #[test]
    fn read_paginates() {
        let (d, dir) = setup();
        let body: Vec<String> =
            (0..25).map(|i| user(&format!("m{i}"), "2026-10-31T10:00:00.000Z")).collect();
        fs::write(dir.join("s1.jsonl"), body.join("\n")).unwrap();
        let p = session_read_impl(d.path(), PP, "s1", 20, 10).unwrap();
        assert_eq!(p.entries.len(), 5);
        assert_eq!(p.total, 25);
        assert_eq!(p.entries[0].text, "m20");
    }

    #[test]
    fn read_rejects_bad_id() {
        let (d, _) = setup();
        for id in ["", "../x", "a/b", "a.b", "a b"] {
            assert!(session_read_impl(d.path(), PP, id, 0, 10).is_err(), "{id}");
        }
    }

    #[test]
    fn large_file_listing_streams() {
        let (d, dir) = setup();
        let mut s = String::new();
        let filler = "z".repeat(300);
        for i in 0..20_000 {
            if i % 2 == 0 {
                s.push_str(&user(&format!("m{i} {filler}"), "2026-10-31T10:00:00.000Z"));
            } else {
                s.push_str(r#"{"type":"assistant","message":{"content":[{"type":"text","text":"r"}]},"timestamp":"2026-10-31T10:00:01.000Z"}"#);
            }
            s.push('\n');
        }
        fs::write(dir.join("big.jsonl"), s).unwrap();
        let t = std::time::Instant::now();
        let l = sessions_list_impl(d.path(), PP, &SessionCache::default());
        assert!(t.elapsed() < std::time::Duration::from_secs(2), "{:?}", t.elapsed());
        assert_eq!(l[0].entries, 20_000);
    }

    fn touch(p: &Path) {
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, "# x").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(30));
    }

    #[test]
    fn docs_order() {
        let d = tempfile::tempdir().unwrap();
        let docs = d.path().join("docs");
        touch(&docs.join("superpowers/plans/p-old.md"));
        touch(&docs.join("superpowers/plans/p-new.md"));
        touch(&docs.join("superpowers/specs/s-old.md"));
        touch(&docs.join("superpowers/specs/s-new.md"));
        touch(&docs.join("superpowers/specs/ignore.txt"));
        touch(&docs.join("STATO-PROGETTO.md"));
        let l = docs_list_impl(d.path().to_str().unwrap());
        assert_eq!(
            l.iter().map(|f| f.name.as_str()).collect::<Vec<_>>(),
            ["STATO-PROGETTO.md", "s-new.md", "s-old.md", "p-new.md", "p-old.md"]
        );
        assert!(docs_list_impl(r"C:\definitely\missing").is_empty());
    }

    #[test]
    fn memories_memory_md_first() {
        let (d, dir) = setup();
        touch(&dir.join("memory/MEMORY.md"));
        touch(&dir.join("memory/a.md"));
        touch(&dir.join("memory/b.md"));
        touch(&dir.join("memory/c.txt"));
        let l = memories_list_impl(d.path(), PP);
        assert_eq!(
            l.iter().map(|f| f.name.as_str()).collect::<Vec<_>>(),
            ["MEMORY.md", "b.md", "a.md"]
        );
    }
}
