use crate::git::runner;
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};
use std::path::Path;
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct CommitInfo {
    pub hash: String,
    pub short: String,
    pub subject: String,
    pub author: String,
    pub email: String,
    pub time: i64,
    pub additions: u32,
    pub deletions: u32,
    pub files: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommitFile {
    pub path: String,
    pub old_path: Option<String>,
    pub status: String,
    pub additions: Option<u32>,
    pub deletions: Option<u32>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct DayCount {
    pub date: String,
    pub count: u32,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
pub struct Heatmap {
    pub days: Vec<DayCount>,
    pub max: u32,
    pub email: Option<String>,
}

type CacheKey = (String, bool);

/// Heatmap cache: `(repo, all_authors)` -> `(fingerprint, heatmap)`.
#[derive(Default)]
pub struct HeatmapCache(pub Mutex<HashMap<CacheKey, (String, Heatmap)>>);

fn valid_hash(h: &str) -> bool {
    !h.is_empty() && h.len() <= 64 && h.chars().all(|c| c.is_ascii_hexdigit())
}

fn valid_date(d: &str) -> bool {
    let b = d.as_bytes();
    b.len() == 10
        && b.iter()
            .enumerate()
            .all(|(i, c)| if i == 4 || i == 7 { *c == b'-' } else { c.is_ascii_digit() })
}

fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

fn civil_from_days(z: i64) -> String {
    let z = z + 719468;
    let era = z.div_euclid(146097);
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{y:04}-{m:02}-{d:02}")
}

fn parse_ymd(d: &str) -> (i64, i64, i64) {
    let n = |r: std::ops::Range<usize>| d[r].parse::<i64>().unwrap_or(1);
    (n(0..4), n(5..7), n(8..10))
}

/// `date` (YYYY-MM-DD) shifted by `n` days.
fn add_days(date: &str, n: i64) -> String {
    let (y, m, d) = parse_ymd(date);
    civil_from_days(days_from_civil(y, m, d) + n)
}

/// Today's date in the local timezone, via git's own idea of "now" (no chrono dependency).
fn local_today(cwd: &Path) -> String {
    let from_git = runner::git_read(cwd, &["var", "GIT_COMMITTER_IDENT"]).ok().and_then(|s| {
        let mut it = s.trim().rsplit(' ');
        let tz = it.next()?;
        let ts: i64 = it.next()?.parse().ok()?;
        let sign = if tz.starts_with('-') { -1 } else { 1 };
        let hh: i64 = tz.get(1..3)?.parse().ok()?;
        let mm: i64 = tz.get(3..5)?.parse().ok()?;
        Some(civil_from_days((ts + sign * (hh * 3600 + mm * 60)).div_euclid(86400)))
    });
    from_git.unwrap_or_else(|| {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        civil_from_days(ts.div_euclid(86400))
    })
}

fn user_email(cwd: &Path) -> String {
    runner::git_read(cwd, &["config", "user.email"])
        .map(|s| s.trim().to_string())
        .unwrap_or_default()
}

// ---------- commit files ----------

fn parse_numstat_z(z: &str) -> HashMap<String, (Option<u32>, Option<u32>)> {
    let mut map = HashMap::new();
    let mut it = z.split('\0');
    while let Some(tok) = it.next() {
        if tok.is_empty() {
            continue;
        }
        let mut p = tok.splitn(3, '\t');
        let (Some(a), Some(d), Some(path)) = (p.next(), p.next(), p.next()) else { continue };
        let path = if path.is_empty() {
            let _old = it.next();
            it.next().unwrap_or("").to_string()
        } else {
            path.to_string()
        };
        map.insert(path, (a.parse().ok(), d.parse().ok()));
    }
    map
}

fn parse_name_status_z(z: &str) -> Vec<(String, String, Option<String>)> {
    let mut out = Vec::new();
    let mut it = z.split('\0');
    while let Some(st) = it.next() {
        if st.is_empty() {
            continue;
        }
        let letter = st.chars().next().unwrap().to_string();
        if st.starts_with('R') || st.starts_with('C') {
            let old = it.next().unwrap_or("").to_string();
            let new = it.next().unwrap_or("").to_string();
            out.push((letter, new, Some(old)));
        } else {
            out.push((letter, it.next().unwrap_or("").to_string(), None));
        }
    }
    out
}

pub fn commit_files_impl(cwd: &Path, hash: &str) -> Result<Vec<CommitFile>, String> {
    if !valid_hash(hash) {
        return Err("hash non valido".into());
    }
    let num = runner::git_read(cwd, &["show", "--format=", "--numstat", "-z", "-M", hash])?;
    let ns = runner::git_read(cwd, &["show", "--format=", "--name-status", "-z", "-M", hash])?;
    let stats = parse_numstat_z(&num);
    Ok(parse_name_status_z(&ns)
        .into_iter()
        .map(|(status, path, old_path)| {
            let (additions, deletions) = stats.get(&path).copied().unwrap_or((None, None));
            CommitFile { path, old_path, status, additions, deletions }
        })
        .collect())
}

// ---------- heatmap ----------

pub fn aggregate(log: &str, email: Option<&str>) -> Heatmap {
    let mut days: BTreeMap<&str, u32> = BTreeMap::new();
    for line in log.lines() {
        let Some((date, mail)) = line.split_once('\t') else { continue };
        if date.is_empty() {
            continue;
        }
        if email.is_some_and(|e| !mail.trim().eq_ignore_ascii_case(e)) {
            continue;
        }
        *days.entry(date).or_insert(0) += 1;
    }
    let days: Vec<DayCount> = days
        .into_iter()
        .map(|(date, count)| DayCount { date: date.to_string(), count })
        .collect();
    let max = days.iter().map(|d| d.count).max().unwrap_or(0);
    Heatmap { days, max, email: email.map(str::to_string) }
}

/// `None` when refs can't be read: the caller then skips the cache.
fn fingerprint(cwd: &Path, today: &str) -> Option<String> {
    let refs = runner::git_read(cwd, &["for-each-ref", "--format=%(objectname)"]).ok()?;
    // HEAD legitimately fails on an unborn branch.
    let head = runner::git_read(cwd, &["rev-parse", "HEAD"]).unwrap_or_default();
    Some(format!("{refs}|{}|{}|{today}", head.trim(), user_email(cwd)))
}

/// Returns the heatmap and whether it came from the cache (no `git log` run).
pub fn heatmap_impl(
    cwd: &Path,
    all_authors: bool,
    cache: &HeatmapCache,
) -> Result<(Heatmap, bool), String> {
    let today = local_today(cwd);
    let fp = fingerprint(cwd, &today);
    let key = (cwd.to_string_lossy().into_owned(), all_authors);
    if let Some(fp) = &fp {
        let guard = cache.0.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((f, h)) = guard.get(&key) {
            if f == fp {
                return Ok((h.clone(), true));
            }
        }
    }
    let email = user_email(cwd);
    let hm = if !all_authors && email.is_empty() {
        Heatmap::default()
    } else {
        let log = runner::git_read(
            cwd,
            &[
                "log", "--all", "--no-merges", "--since=366.days",
                "--date=format-local:%Y-%m-%d", "--format=%ad%x09%ae",
            ],
        )?;
        let min = add_days(&today, -364);
        let kept: String = log
            .lines()
            .filter(|l| l.split('\t').next().is_some_and(|d| d >= min.as_str()))
            .map(|l| format!("{l}\n"))
            .collect();
        aggregate(&kept, if all_authors { None } else { Some(email.as_str()) })
    };
    if let Some(fp) = fp {
        cache.0.lock().unwrap_or_else(|e| e.into_inner()).insert(key, (fp, hm.clone()));
    }
    Ok((hm, false))
}

// ---------- day commits ----------

pub fn day_commits_impl(
    cwd: &Path,
    date: &str,
    all_authors: bool,
) -> Result<Vec<CommitInfo>, String> {
    if !valid_date(date) {
        return Err("data non valida".into());
    }
    let email = user_email(cwd);
    if !all_authors && email.is_empty() {
        return Ok(vec![]);
    }
    // Select by author date in local time: window on committer date, then filter on %ad.
    let since = format!("--since={}", add_days(date, -1));
    let until = format!("--until={}", add_days(date, 2));
    let out = runner::git_read(
        cwd,
        &[
            "log", "--all", "--no-merges", &since, &until, "--numstat", "-M",
            "--date=format-local:%Y-%m-%d",
            "--format=%x1e%H%x1f%h%x1f%s%x1f%an%x1f%ae%x1f%at%x1f%ad",
        ],
    )?;
    let mut res = Vec::new();
    for rec in out.split('\x1e').filter(|r| !r.trim().is_empty()) {
        let mut lines = rec.lines();
        let f: Vec<&str> = lines.next().unwrap_or("").split('\x1f').collect();
        if f.len() < 7 || f[6].trim() != date {
            continue;
        }
        if !all_authors && !f[4].eq_ignore_ascii_case(&email) {
            continue;
        }
        let (mut additions, mut deletions, mut files) = (0u32, 0u32, 0u32);
        for l in lines.filter(|l| !l.trim().is_empty()) {
            let mut p = l.splitn(3, '\t');
            if let (Some(a), Some(d), Some(_)) = (p.next(), p.next(), p.next()) {
                additions += a.parse().unwrap_or(0);
                deletions += d.parse().unwrap_or(0);
                files += 1;
            }
        }
        res.push(CommitInfo {
            hash: f[0].into(),
            short: f[1].into(),
            subject: f[2].into(),
            author: f[3].into(),
            email: f[4].into(),
            time: f[5].trim().parse().unwrap_or(0),
            additions,
            deletions,
            files,
        });
    }
    res.sort_by(|a, b| b.time.cmp(&a.time));
    Ok(res)
}

#[tauri::command(async)]
pub fn git_commit_files(path: String, hash: String) -> Result<Vec<CommitFile>, String> {
    commit_files_impl(Path::new(&path), &hash)
}

#[tauri::command(async)]
pub fn git_heatmap(
    path: String,
    all_authors: bool,
    cache: tauri::State<'_, HeatmapCache>,
) -> Result<Heatmap, String> {
    heatmap_impl(Path::new(&path), all_authors, &cache).map(|(h, _)| h)
}

#[tauri::command(async)]
pub fn git_day_commits(
    path: String,
    date: String,
    all_authors: bool,
) -> Result<Vec<CommitInfo>, String> {
    day_commits_impl(Path::new(&path), &date, all_authors)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::test_repo;

    fn commit_file(p: &Path, name: &str, content: &str, msg: &str) {
        std::fs::write(p.join(name), content).unwrap();
        runner::git(p, &["add", "-A"]).unwrap();
        runner::git(p, &["commit", "-m", msg]).unwrap();
    }

    fn today(p: &Path) -> String {
        local_today(p)
    }

    #[test]
    fn date_helpers() {
        assert_eq!(add_days("2026-03-01", -1), "2026-02-28");
        assert_eq!(add_days("2024-03-01", -1), "2024-02-29");
        assert_eq!(add_days("2026-12-31", 1), "2027-01-01");
        assert_eq!(add_days("2026-10-31", -364), "2025-11-01");
    }

    #[test]
    fn author_date_bucket_consistent() {
        let d = test_repo();
        let p = d.path();
        let t = today(p);
        let y = add_days(&t, -1);
        std::fs::write(p.join("a.txt"), "x").unwrap();
        runner::git(p, &["add", "-A"]).unwrap();
        let ok = std::process::Command::new("git")
            .args(["commit", "-q", "-m", "ieri"])
            .current_dir(p)
            .env("GIT_AUTHOR_DATE", format!("{y}T12:00:00"))
            .status()
            .unwrap()
            .success();
        assert!(ok);
        let (h, _) = heatmap_impl(p, false, &HeatmapCache::default()).unwrap();
        assert_eq!(h.days, vec![DayCount { date: y.clone(), count: 1 }]);
        assert_eq!(day_commits_impl(p, &y, false).unwrap().len(), 1);
        assert!(day_commits_impl(p, &t, false).unwrap().is_empty());
    }

    #[test]
    fn aggregate_filters_email_case_insensitive() {
        let log = "2026-10-30\tMe@Ideal.dev\n2026-10-30\tother@x.io\n2026-10-31\tme@ideal.dev\n";
        let h = aggregate(log, Some("me@ideal.DEV"));
        assert_eq!(
            h.days,
            vec![
                DayCount { date: "2026-10-30".into(), count: 1 },
                DayCount { date: "2026-10-31".into(), count: 1 }
            ]
        );
        assert_eq!(h.max, 1);
        assert_eq!(h.email.as_deref(), Some("me@ideal.DEV"));
    }

    #[test]
    fn aggregate_all_authors() {
        let log = "2026-10-30\ta@x\n2026-10-30\tb@x\n2026-10-29\ta@x\n";
        let h = aggregate(log, None);
        assert_eq!(h.days.len(), 2);
        assert_eq!(h.days[1], DayCount { date: "2026-10-30".into(), count: 2 });
        assert_eq!(h.max, 2);
        assert_eq!(h.email, None);
    }

    #[test]
    fn heatmap_unborn_is_empty() {
        let d = test_repo();
        let (h, _) = heatmap_impl(d.path(), false, &HeatmapCache::default()).unwrap();
        assert!(h.days.is_empty());
        assert_eq!(h.max, 0);
    }

    #[test]
    fn heatmap_real_repo_counts_today() {
        let d = test_repo();
        commit_file(d.path(), "a.txt", "1", "c1");
        commit_file(d.path(), "a.txt", "2", "c2");
        let (h, _) = heatmap_impl(d.path(), false, &HeatmapCache::default()).unwrap();
        let t = today(d.path());
        assert_eq!(h.days.iter().find(|x| x.date == t).map(|x| x.count), Some(2));
        assert_eq!(h.max, 2);
        assert_eq!(h.email.as_deref(), Some("me@ideal.dev"));
    }

    #[test]
    fn heatmap_cache_hit_until_new_commit() {
        let d = test_repo();
        commit_file(d.path(), "a.txt", "1", "c1");
        let cache = HeatmapCache::default();
        assert!(!heatmap_impl(d.path(), false, &cache).unwrap().1);
        assert!(heatmap_impl(d.path(), false, &cache).unwrap().1);
        commit_file(d.path(), "a.txt", "2", "c2");
        let (h, hit) = heatmap_impl(d.path(), false, &cache).unwrap();
        assert!(!hit);
        assert_eq!(h.max, 2);
    }

    #[test]
    fn day_commits_lists_today_with_numstat() {
        let d = test_repo();
        commit_file(d.path(), "a.txt", "1\n2\n", "primo");
        commit_file(d.path(), "a.txt", "1\n", "secondo");
        let v = day_commits_impl(d.path(), &today(d.path()), false).unwrap();
        assert_eq!(v.len(), 2);
        assert_eq!(v[0].subject, "secondo");
        assert_eq!((v[0].additions, v[0].deletions, v[0].files), (0, 1, 1));
        assert_eq!((v[1].additions, v[1].deletions, v[1].files), (2, 0, 1));
        assert_eq!(v[0].email, "me@ideal.dev");
        assert_eq!(v[0].short, &v[0].hash[..v[0].short.len()]);
    }

    #[test]
    fn day_commits_rejects_bad_date() {
        let d = test_repo();
        assert!(day_commits_impl(d.path(), "2026-1-1", true).is_err());
        assert!(day_commits_impl(d.path(), "--output=x", true).is_err());
    }

    #[test]
    fn commit_files_rename_and_binary() {
        let d = test_repo();
        let body = "linea uno\nlinea due\nlinea tre\nlinea quattro\n";
        commit_file(d.path(), "old name.txt", body, "c1");
        runner::git(d.path(), &["mv", "old name.txt", "new name.txt"]).unwrap();
        std::fs::write(d.path().join("img.bin"), [0u8, 1, 2, 3]).unwrap();
        runner::git(d.path(), &["add", "-A"]).unwrap();
        runner::git(d.path(), &["commit", "-m", "c2"]).unwrap();
        let h = runner::git(d.path(), &["rev-parse", "HEAD"]).unwrap();
        let v = commit_files_impl(d.path(), h.trim()).unwrap();
        let bin = v.iter().find(|f| f.path == "img.bin").unwrap();
        assert_eq!((bin.status.as_str(), bin.additions, bin.deletions), ("A", None, None));
        let ren = v.iter().find(|f| f.path == "new name.txt").unwrap();
        assert_eq!(ren.status, "R");
        assert_eq!(ren.old_path.as_deref(), Some("old name.txt"));
        assert_eq!((ren.additions, ren.deletions), (Some(0), Some(0)));
    }
}
