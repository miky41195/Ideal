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

/// Atomic write: temp file in the same directory, then rename over the target
/// (std::fs::rename replaces an existing file on Windows).
pub fn write_text_file_impl(path: &Path, content: &str, eol: &str) -> Result<(), String> {
    let data = apply_eol(&normalize_to_lf(content), eol);
    let file_name = path.file_name().ok_or("percorso non valido")?.to_string_lossy();
    let tmp = path.with_file_name(format!(".{}.ideal-tmp-{}", file_name, std::process::id()));
    let result = (|| -> std::io::Result<()> {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(data.as_bytes())?;
        f.sync_all()?;
        drop(f);
        fs::rename(&tmp, path)
    })();
    if let Err(e) = result {
        let _ = fs::remove_file(&tmp);
        return Err(err(e));
    }
    Ok(())
}

pub fn create_file_impl(path: &Path) -> Result<(), String> {
    fs::OpenOptions::new().write(true).create_new(true).open(path).map(|_| ()).map_err(err)
}

pub fn create_dir_impl(path: &Path) -> Result<(), String> {
    fs::create_dir(path).map_err(err)
}

pub fn rename_path_impl(from: &Path, to: &Path) -> Result<(), String> {
    if to.exists() {
        return Err("la destinazione esiste già".to_string());
    }
    fs::rename(from, to).map_err(err)
}

/// Delete with a pluggable strategy (recycle bin in the app, plain remove in tests).
pub fn delete_path_with(
    path: &Path,
    remover: impl FnOnce(&Path) -> Result<(), String>,
) -> Result<(), String> {
    if !path.exists() {
        return Err("percorso inesistente".to_string());
    }
    remover(path)
}

// ---------- commands ----------

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
    fn rename_onto_existing_fails() {
        let d = tempdir().unwrap();
        let a = d.path().join("a");
        let b = d.path().join("b");
        fs::write(&a, "1").unwrap();
        fs::write(&b, "2").unwrap();
        assert!(rename_path_impl(&a, &b).is_err());
        assert_eq!(fs::read_to_string(&b).unwrap(), "2");
    }
}
