pub mod diff;
pub mod history;
pub mod ops;
pub mod runner;
pub mod status;

#[cfg(test)]
pub fn test_repo() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path();
    runner::git(p, &["init", "-b", "main"]).unwrap();
    runner::git(p, &["config", "user.email", "me@ideal.dev"]).unwrap();
    runner::git(p, &["config", "user.name", "Me"]).unwrap();
    dir
}
