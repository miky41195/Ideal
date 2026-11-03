//! Hot-exit backups: unsaved buffers persisted under `<config>/backups/<project hash>/<file hash>.json`.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

const MAX_BACKUP_BYTES: usize = 5 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Backup {
    pub file_path: String,
    pub content: String,
    pub eol: String,
    pub saved_at: u64,
}

/// FNV-1a 64-bit, implemented locally so hashes are stable across versions.
pub fn fnv1a64(s: &str) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in s.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

fn hex(s: &str) -> String {
    format!("{:016x}", fnv1a64(&s.to_lowercase()))
}

fn project_dir(base: &Path, project: &str) -> PathBuf {
    base.join("backups").join(hex(project))
}

fn file_path(base: &Path, project: &str, file: &str) -> PathBuf {
    project_dir(base, project).join(format!("{}.json", hex(file)))
}

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

pub fn backup_write_impl(base: &Path, project: &str, file: &str, content: &str, eol: &str) -> Result<(), String> {
    if content.len() > MAX_BACKUP_BYTES {
        return Ok(());
    }
    let dir = project_dir(base, project);
    fs::create_dir_all(&dir).map_err(err)?;
    let saved_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let json = serde_json::to_vec(&Backup { file_path: file.to_string(), content: content.to_string(), eol: eol.to_string(), saved_at })
        .map_err(err)?;
    let mut tmp = tempfile::NamedTempFile::new_in(&dir).map_err(err)?;
    tmp.write_all(&json).map_err(err)?;
    tmp.as_file().sync_all().map_err(err)?;
    let target = file_path(base, project, file);
    let mut last = None;
    for _ in 0..20 {
        match tmp.persist(&target) {
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

pub fn backup_clear_impl(base: &Path, project: &str, file: &str) -> Result<(), String> {
    match fs::remove_file(file_path(base, project, file)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(err(e)),
    }
}

/// Readable backups of a project; unreadable or corrupt entries are skipped.
pub fn backup_list_impl(base: &Path, project: &str) -> Vec<Backup> {
    let Ok(rd) = fs::read_dir(project_dir(base, project)) else { return Vec::new() };
    let mut out: Vec<Backup> = rd
        .flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
        .filter_map(|e| serde_json::from_slice::<Backup>(&fs::read(e.path()).ok()?).ok())
        .collect();
    out.sort_by(|a, b| a.file_path.cmp(&b.file_path));
    out
}

pub fn backup_clear_all_impl(base: &Path, project: &str) -> Result<(), String> {
    match fs::remove_dir_all(project_dir(base, project)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(err(e)),
    }
}

#[tauri::command(async)]
pub fn backup_write(project_path: String, file_path: String, content: String, eol: String) -> Result<(), String> {
    backup_write_impl(&crate::settings::config_dir(), &project_path, &file_path, &content, &eol)
}

#[tauri::command(async)]
pub fn backup_clear(project_path: String, file_path: String) -> Result<(), String> {
    backup_clear_impl(&crate::settings::config_dir(), &project_path, &file_path)
}

#[tauri::command(async)]
pub fn backup_list(project_path: String) -> Vec<Backup> {
    backup_list_impl(&crate::settings::config_dir(), &project_path)
}

#[tauri::command(async)]
pub fn backup_clear_all(project_path: String) -> Result<(), String> {
    backup_clear_all_impl(&crate::settings::config_dir(), &project_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn fnv_known_vectors() {
        assert_eq!(format!("{:016x}", fnv1a64("")), "cbf29ce484222325");
        assert_eq!(format!("{:016x}", fnv1a64("a")), "af63dc4c8601ec8c");
    }

    #[test]
    fn roundtrip_write_list_clear() {
        let d = tempdir().unwrap();
        backup_write_impl(d.path(), "C:/P", "C:/P/a.ts", "x\ny", "crlf").unwrap();
        backup_write_impl(d.path(), "C:/P", "C:/P/b.ts", "z", "lf").unwrap();
        backup_write_impl(d.path(), "C:/P", "C:/P/a.ts", "x2", "crlf").unwrap(); // overwrite
        let l = backup_list_impl(d.path(), "c:/p"); // project key is case-insensitive
        assert_eq!(l.len(), 2);
        assert_eq!(l[0].file_path, "C:/P/a.ts");
        assert_eq!(l[0].content, "x2");
        assert_eq!(l[0].eol, "crlf");
        backup_clear_impl(d.path(), "C:/P", "c:/p/A.ts").unwrap();
        assert_eq!(backup_list_impl(d.path(), "C:/P").len(), 1);
        backup_clear_impl(d.path(), "C:/P", "nope").unwrap(); // missing is fine
        backup_clear_all_impl(d.path(), "C:/P").unwrap();
        assert!(backup_list_impl(d.path(), "C:/P").is_empty());
        backup_clear_all_impl(d.path(), "C:/P").unwrap();
    }

    #[test]
    fn projects_are_isolated() {
        let d = tempdir().unwrap();
        backup_write_impl(d.path(), "p1", "f", "c", "lf").unwrap();
        assert!(backup_list_impl(d.path(), "p2").is_empty());
    }

    #[test]
    fn corrupt_entries_are_ignored() {
        let d = tempdir().unwrap();
        backup_write_impl(d.path(), "p", "good", "c", "lf").unwrap();
        fs::write(project_dir(d.path(), "p").join("0000000000000000.json"), b"{not json").unwrap();
        let l = backup_list_impl(d.path(), "p");
        assert_eq!(l.len(), 1);
        assert_eq!(l[0].file_path, "good");
    }

    #[test]
    fn oversized_content_is_skipped() {
        let d = tempdir().unwrap();
        backup_write_impl(d.path(), "p", "big", &"a".repeat(MAX_BACKUP_BYTES + 1), "lf").unwrap();
        assert!(backup_list_impl(d.path(), "p").is_empty());
    }
}
