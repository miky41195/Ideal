use std::path::PathBuf;

#[derive(Debug, PartialEq, Eq)]
pub enum ClaudeError {
    NotFound,
}

impl std::fmt::Display for ClaudeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ClaudeError::NotFound => write!(f, "claude non trovato nel PATH"),
        }
    }
}

/// Resolve the `claude` executable. `path_env = None` uses the process PATH.
pub fn resolve_claude(path_env: Option<&str>) -> Result<PathBuf, ClaudeError> {
    let cwd = std::env::current_dir().unwrap_or_default();
    let found = match path_env {
        Some(p) => which::which_in("claude", Some(p), cwd),
        None => which::which("claude"),
    };
    found.map_err(|_| ClaudeError::NotFound)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_claude_missing() {
        assert_eq!(resolve_claude(Some("")), Err(ClaudeError::NotFound));
    }

    #[test]
    fn resolve_claude_found() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("claude.cmd");
        std::fs::write(&file, "@echo off\r\n").unwrap();
        let got = resolve_claude(Some(dir.path().to_str().unwrap())).unwrap();
        assert_eq!(got.file_name().unwrap().to_ascii_lowercase(), "claude.cmd");
    }

    #[test]
    fn not_found_message() {
        assert_eq!(ClaudeError::NotFound.to_string(), "claude non trovato nel PATH");
    }
}
