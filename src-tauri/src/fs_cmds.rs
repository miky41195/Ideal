use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::Path;

const MAX_READ_BYTES: u64 = 10 * 1024 * 1024;
const BINARY_SNIFF_BYTES: usize = 8 * 1024;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct TextFile {
    pub content: String,
    pub eol: String,
    pub readonly: bool,
    pub reason: Option<String>,
}

// ---------- pure logic ----------

/// "crlf" if the text contains any CRLF sequence, else "lf".
pub fn detect_eol(text: &str) -> &'static str {
    if text.contains("\r\n") { "crlf" } else { "lf" }
}

/// Normalize CRLF to LF.
pub fn normalize_to_lf(text: &str) -> String {
    text.replace("\r\n", "\n")
}

/// Convert LF text to the requested eol ("crlf" or anything else = lf).
pub fn apply_eol(text: &str, eol: &str) -> String {
    if eol == "crlf" { text.replace('\n', "\r\n") } else { text.to_string() }
}

/// Classify raw bytes: Ok(text) or Err(reason) for readonly files.
pub fn classify_bytes(bytes: Vec<u8>) -> Result<String, &'static str> {
    if bytes.iter().take(BINARY_SNIFF_BYTES).any(|&b| b == 0) {
        return Err("binario");
    }
    String::from_utf8(bytes).map_err(|_| "non UTF-8")
}

// ---------- core fns ----------

fn err(e: std::io::Error) -> String {
    e.to_string()
}

pub fn list_dir_impl(path: &Path) -> Result<Vec<DirEntry>, String> {
    let mut out = Vec::new();
    for entry in fs::read_dir(path).map_err(err)? {
        let entry = entry.map_err(err)?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name == ".git" {
            continue;
        }
        let is_dir = entry.file_type().map_err(err)?.is_dir();
        out.push(DirEntry { name, path: entry.path().to_string_lossy().into_owned(), is_dir });
    }
    out.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
            .then_with(|| a.name.cmp(&b.name))
    });
    Ok(out)
}

fn readonly(reason: &str, eol: &str) -> TextFile {
    TextFile {
        content: String::new(),
        eol: eol.to_string(),
        readonly: true,
        reason: Some(reason.to_string()),
    }
}

/// Mixed line endings: any CRLF makes the file "crlf", so it is normalized to
/// LF in memory and saved back as all-CRLF (lone carriage return is left untouched).
pub fn read_text_file_impl(path: &Path) -> Result<TextFile, String> {
    let meta = fs::metadata(path).map_err(err)?;
    if meta.len() > MAX_READ_BYTES {
        return Ok(readonly("troppo grande", "lf"));
    }
    let bytes = fs::read(path).map_err(err)?;
    match classify_bytes(bytes) {
        Ok(text) => Ok(TextFile {
            eol: detect_eol(&text).to_string(),
            content: normalize_to_lf(&text),
            readonly: false,
            reason: None,
        }),
        Err(reason) => Ok(readonly(reason, "lf")),
    }
}

/// Atomic write: unique temp file in the same directory, then rename over the
/// target. Guards: refuses read-only, binary, non-UTF-8 or >10 MB existing files.
/// Note: replacing via rename drops the old file's attributes/ACLs and, if the
/// target is a symlink, replaces the link itself rather than its destination.
pub fn write_text_file_impl(path: &Path, content: &str, eol: &str) -> Result<(), String> {
    if let Ok(meta) = fs::metadata(path) {
        if meta.permissions().readonly() {
            return Err("file di sola lettura".to_string());
        }
        if meta.is_file() {
            if meta.len() > MAX_READ_BYTES {
                return Err("troppo grande".to_string());
            }
            classify_bytes(fs::read(path).map_err(err)?).map_err(|r| r.to_string())?;
        }
    }
    let data = apply_eol(&normalize_to_lf(content), eol);
    let dir = path.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(Path::new("."));
    path.file_name().ok_or("percorso non valido")?;
    let mut tmp = tempfile::NamedTempFile::new_in(dir).map_err(err)?;
    tmp.write_all(data.as_bytes()).map_err(err)?;
    tmp.as_file().sync_all().map_err(err)?;
    // On Windows a rename can transiently fail under contention; retry briefly.
    let mut last = None;
    for _ in 0..20 {
        match tmp.persist(path) {
            Ok(_) => return Ok(()),
            Err(e) => {
                tmp = e.file;
                last = Some(e.error);
                std::thread::sleep(std::time::Duration::from_millis(5));
            }
        }
    }
    Err(err(last.unwrap()))
}

pub fn create_file_impl(path: &Path) -> Result<(), String> {
    fs::OpenOptions::new().write(true).create_new(true).open(path).map(|_| ()).map_err(err)
}

pub fn create_dir_impl(path: &Path) -> Result<(), String> {
    fs::create_dir(path).map_err(err)
}

pub fn rename_path_impl(from: &Path, to: &Path) -> Result<(), String> {
    let case_only = from != to
        && from.to_string_lossy().to_lowercase() == to.to_string_lossy().to_lowercase();
    if !case_only && to.exists() {
        return Err("la destinazione esiste già".to_string());
    }
    fs::rename(from, to).map_err(err)
}

/// Delete with a pluggable strategy (recycle bin in the app, plain remove in tests).
pub fn delete_path_with(
    path: &Path,
    remover: impl FnOnce(&Path) -> Result<(), String>,
) -> Result<(), String> {
    if fs::symlink_metadata(path).is_err() {
        return Err("percorso inesistente".to_string());
    }
    remover(path)
}

/// Appends `entry` to `<project>/.gitignore` unless an equivalent line exists
/// (ignoring surrounding whitespace and leading/trailing slashes). Creates the
/// file if missing and keeps the file's existing EOL style.
pub fn gitignore_add_impl(project: &Path, entry: &str) -> Result<(), String> {
    let entry = entry.trim();
    if entry.is_empty() {
        return Err("voce vuota".to_string());
    }
    let path = project.join(".gitignore");
    let existing = match fs::read(&path) {
        Ok(b) => classify_bytes(b).map_err(|r| r.to_string())?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(err(e)),
    };
    let norm = |l: &str| l.trim().trim_matches('/').to_string();
    let want = norm(entry);
    if existing.lines().any(|l| !l.trim_start().starts_with('#') && norm(l) == want) {
        return Ok(());
    }
    let eol = detect_eol(&existing);
    let mut out = normalize_to_lf(&existing);
    if !out.is_empty() && !out.ends_with('\n') {
        out.push('\n');
    }
    out.push_str(entry);
    out.push('\n');
    write_text_file_impl(&path, &out, eol)
}

// ---------- commands ----------

#[tauri::command(async)]
pub fn gitignore_add(project_path: String, entry: String) -> Result<(), String> {
    gitignore_add_impl(Path::new(&project_path), &entry)
}

#[tauri::command(async)]
pub fn list_dir(path: String) -> Result<Vec<DirEntry>, String> {
    list_dir_impl(Path::new(&path))
}

#[tauri::command(async)]
pub fn read_text_file(path: String) -> Result<TextFile, String> {
    read_text_file_impl(Path::new(&path))
}

#[tauri::command(async)]
pub fn write_text_file(path: String, content: String, eol: String) -> Result<(), String> {
    write_text_file_impl(Path::new(&path), &content, &eol)
}

#[tauri::command(async)]
pub fn create_file(path: String) -> Result<(), String> {
    create_file_impl(Path::new(&path))
}

#[tauri::command(async)]
pub fn create_dir(path: String) -> Result<(), String> {
    create_dir_impl(Path::new(&path))
}

#[tauri::command(async)]
pub fn rename_path(from: String, to: String) -> Result<(), String> {
    rename_path_impl(Path::new(&from), Path::new(&to))
}

#[tauri::command(async)]
pub fn delete_path(path: String) -> Result<(), String> {
    delete_path_with(Path::new(&path), |p| trash::delete(p).map_err(|e| e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn rm(p: &Path) -> Result<(), String> {
        if p.is_dir() { fs::remove_dir_all(p) } else { fs::remove_file(p) }.map_err(|e| e.to_string())
    }

    #[test]
    fn list_dir_sorts_dirs_first() {
        let d = tempdir().unwrap();
        fs::write(d.path().join("b.txt"), "").unwrap();
        fs::write(d.path().join("A.txt"), "").unwrap();
        fs::create_dir(d.path().join("zdir")).unwrap();
        fs::create_dir(d.path().join("Adir")).unwrap();
        fs::create_dir(d.path().join(".git")).unwrap();
        let names: Vec<_> = list_dir_impl(d.path()).unwrap().into_iter().map(|e| e.name).collect();
        assert_eq!(names, ["Adir", "zdir", "A.txt", "b.txt"]);
    }

    #[test]
    fn read_detects_crlf() {
        let d = tempdir().unwrap();
        let p = d.path().join("f.txt");
        fs::write(&p, "a\r\nb").unwrap();
        let t = read_text_file_impl(&p).unwrap();
        assert_eq!(t.eol, "crlf");
        assert_eq!(t.content, "a\nb");
        assert!(!t.readonly);
    }

    #[test]
    fn write_preserves_crlf() {
        let d = tempdir().unwrap();
        let p = d.path().join("f.txt");
        write_text_file_impl(&p, "x\ny", "crlf").unwrap();
        assert_eq!(fs::read(&p).unwrap(), b"x\r\ny");
        write_text_file_impl(&p, "x\ny", "lf").unwrap();
        assert_eq!(fs::read(&p).unwrap(), b"x\ny");
        // no temp files left behind
        assert_eq!(fs::read_dir(d.path()).unwrap().count(), 1);
    }

    #[test]
    fn read_binary_is_readonly() {
        let d = tempdir().unwrap();
        let p = d.path().join("b.bin");
        fs::write(&p, [0u8, 1, 2]).unwrap();
        let t = read_text_file_impl(&p).unwrap();
        assert!(t.readonly);
        assert_eq!(t.reason.as_deref(), Some("binario"));
        assert_eq!(t.content, "");
    }

    #[test]
    fn read_latin1_is_readonly() {
        let d = tempdir().unwrap();
        let p = d.path().join("l.txt");
        fs::write(&p, [0xE8u8]).unwrap();
        let t = read_text_file_impl(&p).unwrap();
        assert!(t.readonly);
        assert_eq!(t.reason.as_deref(), Some("non UTF-8"));
    }

    #[test]
    fn read_too_large_is_readonly() {
        let d = tempdir().unwrap();
        let p = d.path().join("big.txt");
        let f = fs::File::create(&p).unwrap();
        f.set_len(MAX_READ_BYTES + 1).unwrap();
        let t = read_text_file_impl(&p).unwrap();
        assert!(t.readonly);
        assert_eq!(t.reason.as_deref(), Some("troppo grande"));
        assert_eq!(t.content, "");
    }

    #[test]
    fn pure_eol_helpers() {
        assert_eq!(detect_eol("a\nb"), "lf");
        assert_eq!(detect_eol("a\r\nb"), "crlf");
        assert_eq!(normalize_to_lf("a\r\nb\r\n"), "a\nb\n");
        assert_eq!(apply_eol("a\nb", "crlf"), "a\r\nb");
        assert_eq!(apply_eol("a\nb", "lf"), "a\nb");
        assert_eq!(classify_bytes(b"ok".to_vec()), Ok("ok".to_string()));
        assert_eq!(classify_bytes(vec![b'a', 0]), Err("binario"));
        assert_eq!(classify_bytes(vec![0xE8]), Err("non UTF-8"));
        // NUL after the first 8 KB is not sniffed as binary
        let mut late = vec![b'a'; BINARY_SNIFF_BYTES];
        late.push(0);
        assert!(classify_bytes(late).is_ok());
    }

    #[test]
    fn ops_with_unicode_path() {
        let d = tempdir().unwrap();
        let dir = d.path().join("Mio Progetto è");
        create_dir_impl(&dir).unwrap();
        let f = dir.join("file è.txt");
        create_file_impl(&f).unwrap();
        let f2 = dir.join("nuovo è.txt");
        rename_path_impl(&f, &f2).unwrap();
        assert!(!f.exists() && f2.exists());
        delete_path_with(&f2, rm).unwrap();
        assert!(!f2.exists());
        delete_path_with(&dir, rm).unwrap();
        assert!(!dir.exists());
    }

    #[test]
    fn create_existing_fails() {
        let d = tempdir().unwrap();
        let f = d.path().join("a.txt");
        create_file_impl(&f).unwrap();
        assert!(create_file_impl(&f).is_err());
        let sub = d.path().join("s");
        create_dir_impl(&sub).unwrap();
        assert!(create_dir_impl(&sub).is_err());
    }

    #[test]
    fn write_refuses_binary_nonutf8_large_readonly() {
        let d = tempdir().unwrap();
        let bin = d.path().join("b");
        fs::write(&bin, [0u8, 1]).unwrap();
        assert_eq!(write_text_file_impl(&bin, "x", "lf"), Err("binario".to_string()));
        assert_eq!(fs::read(&bin).unwrap(), [0u8, 1]);
        let l1 = d.path().join("l");
        fs::write(&l1, [0xE8u8]).unwrap();
        assert_eq!(write_text_file_impl(&l1, "x", "lf"), Err("non UTF-8".to_string()));
        let big = d.path().join("big");
        fs::File::create(&big).unwrap().set_len(MAX_READ_BYTES + 1).unwrap();
        assert_eq!(write_text_file_impl(&big, "x", "lf"), Err("troppo grande".to_string()));
        let ro = d.path().join("ro");
        fs::write(&ro, "a").unwrap();
        let mut perm = fs::metadata(&ro).unwrap().permissions();
        perm.set_readonly(true);
        fs::set_permissions(&ro, perm.clone()).unwrap();
        assert_eq!(write_text_file_impl(&ro, "x", "lf"), Err("file di sola lettura".to_string()));
        #[allow(clippy::permissions_set_readonly_false)]
        perm.set_readonly(false);
        fs::set_permissions(&ro, perm).unwrap();
        assert_eq!(fs::read_to_string(&ro).unwrap(), "a");
    }

    #[test]
    fn concurrent_saves_leave_one_whole_version() {
        let d = tempdir().unwrap();
        let p = d.path().join("f.txt");
        write_text_file_impl(&p, "init", "lf").unwrap();
        let a = "A".repeat(100_000);
        let b = "B".repeat(100_000);
        let hs: Vec<_> = [a.clone(), b.clone()]
            .into_iter()
            .map(|c| {
                let p = p.clone();
                std::thread::spawn(move || {
                    for _ in 0..20 {
                        write_text_file_impl(&p, &c, "lf").unwrap();
                    }
                })
            })
            .collect();
        for h in hs {
            h.join().unwrap();
        }
        let got = fs::read_to_string(&p).unwrap();
        assert!(got == a || got == b);
        assert_eq!(fs::read_dir(d.path()).unwrap().count(), 1);
    }

    #[test]
    fn rename_case_only_and_dir() {
        let d = tempdir().unwrap();
        let f = d.path().join("abc.txt");
        fs::write(&f, "1").unwrap();
        let f2 = d.path().join("ABC.txt");
        rename_path_impl(&f, &f2).unwrap();
        let names: Vec<_> = list_dir_impl(d.path()).unwrap().into_iter().map(|e| e.name).collect();
        assert_eq!(names, ["ABC.txt"]);
        let dir = d.path().join("d1");
        fs::create_dir(&dir).unwrap();
        fs::write(dir.join("x"), "x").unwrap();
        let dir2 = d.path().join("d2");
        rename_path_impl(&dir, &dir2).unwrap();
        assert!(dir2.join("x").exists() && !dir.exists());
    }

    #[test]
    fn rename_onto_existing_fails() {
        let d = tempdir().unwrap();
        let a = d.path().join("a");
        let b = d.path().join("b");
        fs::write(&a, "1").unwrap();
        fs::write(&b, "2").unwrap();
        assert!(rename_path_impl(&a, &b).is_err());
        assert_eq!(fs::read_to_string(&b).unwrap(), "2");
    }

    #[test]
    fn gitignore_add_creates_file() {
        let d = tempdir().unwrap();
        gitignore_add_impl(d.path(), ".ideal/").unwrap();
        assert_eq!(fs::read_to_string(d.path().join(".gitignore")).unwrap(), ".ideal/\n");
    }

    #[test]
    fn gitignore_add_idempotent() {
        let d = tempdir().unwrap();
        let f = d.path().join(".gitignore");
        fs::write(&f, "target\n/.ideal\n").unwrap();
        gitignore_add_impl(d.path(), ".ideal/").unwrap();
        gitignore_add_impl(d.path(), ".ideal/").unwrap();
        assert_eq!(fs::read_to_string(&f).unwrap(), "target\n/.ideal\n");
        fs::write(&f, "target").unwrap();
        gitignore_add_impl(d.path(), ".ideal/").unwrap();
        gitignore_add_impl(d.path(), ".ideal/").unwrap();
        assert_eq!(fs::read_to_string(&f).unwrap(), "target\n.ideal/\n");
    }

    #[test]
    fn gitignore_add_crlf_preserved() {
        let d = tempdir().unwrap();
        let f = d.path().join(".gitignore");
        fs::write(&f, "target\r\nnode_modules").unwrap();
        gitignore_add_impl(d.path(), ".ideal/").unwrap();
        assert_eq!(
            fs::read(&f).unwrap(),
            b"target\r\nnode_modules\r\n.ideal/\r\n".to_vec()
        );
    }

    #[test]
    fn gitignore_add_ignores_comments_and_negations() {
        let d = tempdir().unwrap();
        let f = d.path().join(".gitignore");
        fs::write(&f, "# .ideal/\n!.ideal/\n").unwrap();
        gitignore_add_impl(d.path(), ".ideal/").unwrap();
        assert_eq!(fs::read_to_string(&f).unwrap(), "# .ideal/\n!.ideal/\n.ideal/\n");
    }
}
