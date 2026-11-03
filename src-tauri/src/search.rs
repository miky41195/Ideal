use grep_matcher::Matcher;
use grep_regex::RegexMatcherBuilder;
use ignore::WalkBuilder;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

const MAX_FILES: usize = 50_000;
const MAX_RESULTS: usize = 2_000;
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_TEXT_CHARS: usize = 300;

#[derive(Serialize, Debug)]
pub struct FileList {
    pub files: Vec<String>,
    pub truncated: bool,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SearchOpts {
    pub regex: bool,
    pub case_sensitive: bool,
    pub whole_word: bool,
}

#[derive(Serialize, Debug)]
pub struct Match {
    pub path: String,
    pub line: u32,
    pub col: u32,
    pub len: u32,
    pub text: String,
}

#[derive(Serialize, Debug)]
pub struct SearchResult {
    pub matches: Vec<Match>,
    pub truncated: bool,
    pub superseded: bool,
}

fn walker(root: &str) -> ignore::Walk {
    WalkBuilder::new(root)
        .hidden(false)
        .require_git(false)
        .filter_entry(|e| e.file_name() != ".git")
        .build()
}

fn rel(root: &Path, p: &Path) -> Option<String> {
    let r = p.strip_prefix(root).ok()?;
    Some(r.to_string_lossy().replace('\\', "/"))
}

pub fn project_files_impl(root: &str, cap: usize) -> Result<FileList, String> {
    let rootp = Path::new(root);
    if !rootp.is_dir() {
        return Err("Cartella non trovata".into());
    }
    let mut files = Vec::new();
    let mut truncated = false;
    for e in walker(root).flatten() {
        if !e.file_type().map_or(false, |t| t.is_file()) {
            continue;
        }
        if files.len() >= cap {
            truncated = true;
            break;
        }
        if let Some(r) = rel(rootp, e.path()) {
            files.push(r);
        }
    }
    files.sort();
    Ok(FileList { files, truncated })
}

fn utf16_len(s: &str) -> u32 {
    s.encode_utf16().count() as u32
}

/// Window of at most MAX_TEXT_CHARS chars containing the match start.
/// Returns (text, col, len) with col/len in UTF-16 units relative to text.
fn window_text(line: &str, s: usize, en: usize) -> Option<(String, u32, u32)> {
    let pre = line.get(..s)?;
    let mt = line.get(s..en)?;
    let w_start = if pre.chars().take(MAX_TEXT_CHARS / 2).count() < MAX_TEXT_CHARS / 2 {
        0
    } else {
        pre.char_indices().rev().nth(MAX_TEXT_CHARS / 4 - 1).map_or(0, |c| c.0)
    };
    let w_end = line[w_start..].char_indices().nth(MAX_TEXT_CHARS).map_or(line.len(), |c| w_start + c.0);
    let m_end = en.min(w_end);
    let text = &line[w_start..w_end];
    let _ = mt;
    Some((
        text.to_string(),
        utf16_len(&line[w_start..s]),
        utf16_len(&line[s..m_end]),
    ))
}

pub fn project_search_impl(
    root: &str,
    query: &str,
    opts: &SearchOpts,
    cap: usize,
    generation: u64,
    current: &AtomicU64,
) -> Result<SearchResult, String> {
    let mut res = SearchResult { matches: Vec::new(), truncated: false, superseded: false };
    if query.trim().is_empty() {
        return Ok(res);
    }
    let rootp = Path::new(root);
    if !rootp.is_dir() {
        return Err("Cartella non trovata".into());
    }
    let pattern = if opts.regex { query.to_string() } else { regex_syntax::escape(query) };
    let matcher = RegexMatcherBuilder::new()
        .case_insensitive(!opts.case_sensitive)
        .word(opts.whole_word)
        .build(&pattern)
        .map_err(|e| format!("Regex non valida: {e}"))?;
    'walk: for e in walker(root).flatten() {
        if current.load(Ordering::Relaxed) != generation {
            res.superseded = true;
            res.matches.clear();
            return Ok(res);
        }
        if !e.file_type().map_or(false, |t| t.is_file()) {
            continue;
        }
        if e.metadata().map_or(true, |m| m.len() > MAX_FILE_BYTES) {
            continue;
        }
        let Some(path) = rel(rootp, e.path()) else { continue };
        let Ok(bytes) = std::fs::read(e.path()) else { continue };
        if bytes.contains(&0) {
            continue; // binary
        }
        // Own line splitting: handles LF and CRLF, `text` never carries a CR.
        for (i, raw) in bytes.split(|&b| b == b'\n').enumerate() {
            let raw = raw.strip_suffix(b"\r").unwrap_or(raw);
            let text_full = String::from_utf8_lossy(raw);
            let mut spans = Vec::new();
            let _ = matcher.find_iter(text_full.as_bytes(), |m| {
                spans.push((m.start(), m.end()));
                true
            });
            for (s, en) in spans {
                if res.matches.len() >= cap {
                    res.truncated = true;
                    break 'walk;
                }
                if en <= s {
                    continue; // zero-length match
                }
                let Some((text, col, len)) = window_text(&text_full, s, en) else {
                    continue;
                };
                res.matches.push(Match {
                    path: path.clone(),
                    line: i as u32 + 1,
                    col,
                    len,
                    text,
                });
            }
        }
    }
    if current.load(Ordering::Relaxed) != generation {
        res.superseded = true;
        res.matches.clear();
    }
    Ok(res)
}

#[tauri::command(async)]
pub async fn project_files(root: String) -> Result<FileList, String> {
    tauri::async_runtime::spawn_blocking(move || project_files_impl(&root, MAX_FILES))
        .await
        .map_err(|e| e.to_string())?
}

/// Supersede counters, one per window label.
#[derive(Default)]
pub struct SearchGens(Mutex<HashMap<String, Arc<AtomicU64>>>);

impl SearchGens {
    /// Start a new search for `label`: returns its counter and generation.
    pub fn begin(&self, label: &str) -> (Arc<AtomicU64>, u64) {
        let mut m = self.0.lock().unwrap_or_else(|e| e.into_inner());
        let c = m.entry(label.to_string()).or_default().clone();
        let g = c.fetch_add(1, Ordering::SeqCst) + 1;
        (c, g)
    }
    pub fn remove(&self, label: &str) {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).remove(label);
    }
}

#[tauri::command(async)]
pub async fn project_search(
    window: tauri::WebviewWindow,
    gens: tauri::State<'_, SearchGens>,
    root: String,
    query: String,
    opts: SearchOpts,
) -> Result<SearchResult, String> {
    let (counter, generation) = gens.begin(window.label());
    tauri::async_runtime::spawn_blocking(move || {
        project_search_impl(&root, &query, &opts, MAX_RESULTS, generation, &counter)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::AtomicU64;

    fn fixture() -> tempfile::TempDir {
        let d = tempfile::tempdir().unwrap();
        let r = d.path();
        fs::create_dir_all(r.join("node_modules")).unwrap();
        fs::create_dir_all(r.join(".git")).unwrap();
        fs::create_dir_all(r.join("src")).unwrap();
        fs::write(r.join(".gitignore"), "node_modules\n").unwrap();
        fs::write(r.join("node_modules/x.js"), "foo\n").unwrap();
        fs::write(r.join(".git/config"), "foo\n").unwrap();
        fs::write(r.join("src/a.ts"), "const a = 1;\nfoo(1);\n").unwrap();
        fs::write(r.join("b.txt"), "hello\n").unwrap();
        d
    }
    fn opts() -> SearchOpts {
        SearchOpts { regex: false, case_sensitive: false, whole_word: false }
    }
    fn root(d: &tempfile::TempDir) -> String {
        d.path().to_string_lossy().to_string()
    }

    #[test]
    fn files_respect_gitignore() {
        let d = fixture();
        let l = project_files_impl(&root(&d), MAX_FILES).unwrap();
        assert!(!l.files.iter().any(|f| f.contains("node_modules")));
        assert!(l.files.contains(&".gitignore".to_string()));
        assert!(!l.files.iter().any(|f| f.starts_with(".git/")));
        assert!(l.files.contains(&"src/a.ts".to_string()));
        let mut s = l.files.clone();
        s.sort();
        assert_eq!(s, l.files);
        assert!(!l.truncated);
    }

    #[test]
    fn files_truncated_at_cap() {
        let d = fixture();
        let l = project_files_impl(&root(&d), 2).unwrap();
        assert_eq!(l.files.len(), 2);
        assert!(l.truncated);
    }

    #[test]
    fn search_literal_case_insensitive() {
        let d = fixture();
        let g = AtomicU64::new(1);
        let r = project_search_impl(&root(&d), "Foo", &opts(), 100, 1, &g).unwrap();
        assert_eq!(r.matches.len(), 1);
        let m = &r.matches[0];
        assert_eq!((m.path.as_str(), m.line, m.col, m.len), ("src/a.ts", 2, 0, 3));
        assert_eq!(m.text, "foo(1);");
    }

    #[test]
    fn search_regex_and_whole_word() {
        let d = fixture();
        let g = AtomicU64::new(1);
        fs::write(d.path().join("w.txt"), "foobar foo\n").unwrap();
        let mut o = opts();
        o.whole_word = true;
        let r = project_search_impl(&root(&d), "foo", &o, 100, 1, &g).unwrap();
        let w: Vec<_> = r.matches.iter().filter(|m| m.path == "w.txt").collect();
        assert_eq!(w.len(), 1);
        assert_eq!(w[0].col, 7);
        let o = SearchOpts { regex: true, case_sensitive: false, whole_word: false };
        let r = project_search_impl(&root(&d), "fo+bar", &o, 100, 1, &g).unwrap();
        assert_eq!(r.matches.len(), 1);
        // literal mode must not treat the query as regex
        let r = project_search_impl(&root(&d), "fo+bar", &opts(), 100, 1, &g).unwrap();
        assert!(r.matches.is_empty());
    }

    #[test]
    fn search_skips_binary_and_large() {
        let d = fixture();
        let g = AtomicU64::new(1);
        fs::write(d.path().join("bin.dat"), b"foo\0foo").unwrap();
        let mut big = "foo\n".to_string();
        big.push_str(&"x".repeat(2 * 1024 * 1024 + 10));
        fs::write(d.path().join("big.txt"), big).unwrap();
        let r = project_search_impl(&root(&d), "foo", &opts(), 100, 1, &g).unwrap();
        assert!(!r.matches.iter().any(|m| m.path == "bin.dat" || m.path == "big.txt"));
        assert!(r.matches.iter().any(|m| m.path == "src/a.ts"));
    }

    #[test]
    fn search_truncates_at_max() {
        let d = fixture();
        let g = AtomicU64::new(1);
        fs::write(d.path().join("m.txt"), "foo\nfoo\nfoo\nfoo\n").unwrap();
        let r = project_search_impl(&root(&d), "foo", &opts(), 2, 1, &g).unwrap();
        assert_eq!(r.matches.len(), 2);
        assert!(r.truncated);
    }

    #[test]
    fn invalid_regex_errors() {
        let d = fixture();
        let g = AtomicU64::new(1);
        let o = SearchOpts { regex: true, case_sensitive: false, whole_word: false };
        let e = project_search_impl(&root(&d), "(", &o, 100, 1, &g).unwrap_err();
        assert!(e.starts_with("Regex non valida: "), "{e}");
    }

    #[test]
    fn empty_query_no_matches() {
        let d = fixture();
        let g = AtomicU64::new(1);
        let r = project_search_impl(&root(&d), "  ", &opts(), 100, 1, &g).unwrap();
        assert!(r.matches.is_empty() && !r.truncated && !r.superseded);
    }

    #[test]
    fn superseded_search_stops() {
        let d = fixture();
        let g = AtomicU64::new(2); // newer search already started
        let r = project_search_impl(&root(&d), "foo", &opts(), 100, 1, &g).unwrap();
        assert!(r.superseded);
        assert!(r.matches.is_empty());
    }

    #[test]
    fn col_is_utf16() {
        let d = fixture();
        let g = AtomicU64::new(1);
        fs::write(d.path().join("u.txt"), "àà foo\n😀 foo\n").unwrap();
        let r = project_search_impl(&root(&d), "foo", &opts(), 100, 1, &g).unwrap();
        let u: Vec<_> = r.matches.iter().filter(|m| m.path == "u.txt").collect();
        assert_eq!(u[0].col, 3);
        assert_eq!(u[1].col, 3); // emoji = 2 UTF-16 units + space
    }

    #[test]
    fn text_is_windowed_around_late_match() {
        let d = fixture();
        let g = AtomicU64::new(1);
        let line = format!("{}needle{}\n", "x".repeat(1000), "y".repeat(4000));
        fs::write(d.path().join("min.js"), line).unwrap();
        let r = project_search_impl(&root(&d), "needle", &opts(), 100, 1, &g).unwrap();
        let m = r.matches.iter().find(|m| m.path == "min.js").unwrap();
        let u: Vec<u16> = m.text.encode_utf16().collect();
        assert!(m.text.chars().count() <= 300);
        let got = String::from_utf16(&u[m.col as usize..(m.col + m.len) as usize]).unwrap();
        assert_eq!(got, "needle");
    }

    #[test]
    fn long_match_is_clipped_to_window() {
        let (t, col, len) = window_text(&"a".repeat(1000), 0, 1000).unwrap();
        assert_eq!(t.len(), 300);
        assert_eq!((col, len), (0, 300));
    }

    #[test]
    fn gens_are_per_window() {
        let g = SearchGens::default();
        let (ca, ga) = g.begin("a");
        let (cb, gb) = g.begin("b");
        assert_eq!(ca.load(Ordering::SeqCst), ga);
        assert_eq!(cb.load(Ordering::SeqCst), gb);
        let (_, ga2) = g.begin("a");
        assert_ne!(ca.load(Ordering::SeqCst), ga); // a superseded
        assert_eq!(cb.load(Ordering::SeqCst), gb); // b untouched
        assert_eq!(ga2, 2);
    }

    #[test]
    fn crlf_dollar_matches() {
        let d = fixture();
        let g = AtomicU64::new(1);
        fs::write(d.path().join("c.txt"), "let a = 1;\r\nb\r\n").unwrap();
        let o = SearchOpts { regex: true, case_sensitive: false, whole_word: false };
        let r = project_search_impl(&root(&d), ";$", &o, 100, 1, &g).unwrap();
        let m = r.matches.iter().find(|m| m.path == "c.txt").expect("crlf match");
        assert_eq!((m.line, m.col, m.len), (1, 9, 1));
        assert!(!m.text.contains('\r'));
        fs::write(d.path().join("l.txt"), "let a = 1;\nb\n").unwrap();
        let r = project_search_impl(&root(&d), ";$", &o, 100, 1, &g).unwrap();
        assert!(r.matches.iter().any(|m| m.path == "l.txt" && m.line == 1));
    }

    #[test]
    fn zero_length_matches_skipped() {
        let d = fixture();
        let g = AtomicU64::new(1);
        let o = SearchOpts { regex: true, case_sensitive: false, whole_word: false };
        let r = project_search_impl(&root(&d), "z*", &o, 2, 1, &g).unwrap();
        assert!(r.matches.is_empty() && !r.truncated);
    }

    #[test]
    fn missing_root_errors() {
        let g = AtomicU64::new(1);
        let e = project_search_impl("C:/no/such/dir", "x", &opts(), 10, 1, &g).unwrap_err();
        assert_eq!(e, "Cartella non trovata");
        assert_eq!(project_files_impl("C:/no/such/dir", 10).unwrap_err(), "Cartella non trovata");
    }
}
