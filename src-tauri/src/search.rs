use grep_matcher::Matcher;
use grep_regex::RegexMatcherBuilder;
use grep_searcher::{sinks::Lossy, BinaryDetection, SearcherBuilder};
use ignore::WalkBuilder;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

const MAX_FILES: usize = 50_000;
const MAX_RESULTS: usize = 2_000;
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_TEXT_CHARS: usize = 300;

static SEARCH_GEN: AtomicU64 = AtomicU64::new(0);

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
    let mut searcher = SearcherBuilder::new()
        .binary_detection(BinaryDetection::quit(0))
        .line_number(true)
        .build();

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
        let mut stop = false;
        let _ = searcher.search_path(
            &matcher,
            e.path(),
            Lossy(|lnum, line| {
                let text_full = line.trim_end_matches(['\n', '\r']);
                let mut spans = Vec::new();
                let _ = matcher.find_iter(text_full.as_bytes(), |m| {
                    spans.push((m.start(), m.end()));
                    true
                });
                for (s, en) in spans {
                    if res.matches.len() >= cap {
                        res.truncated = true;
                        stop = true;
                        return Ok(false);
                    }
                    // keep the match inside the truncated text
                    let mut end_byte = text_full
                        .char_indices()
                        .nth(MAX_TEXT_CHARS)
                        .map_or(text_full.len(), |(i, _)| i);
                    if en > end_byte {
                        end_byte = en;
                    }
                    let text = &text_full[..end_byte];
                    let (Some(pre), Some(mt)) = (text_full.get(..s), text_full.get(s..en)) else {
                        continue;
                    };
                    res.matches.push(Match {
                        path: path.clone(),
                        line: lnum as u32,
                        col: utf16_len(pre),
                        len: utf16_len(mt),
                        text: text.to_string(),
                    });
                }
                Ok(true)
            }),
        );
        if stop {
            break 'walk;
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

#[tauri::command(async)]
pub async fn project_search(
    root: String,
    query: String,
    opts: SearchOpts,
) -> Result<SearchResult, String> {
    let generation = SEARCH_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    tauri::async_runtime::spawn_blocking(move || {
        project_search_impl(&root, &query, &opts, MAX_RESULTS, generation, &SEARCH_GEN)
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
}
