//! Backups for emergencies (Plasticity: Preferences › Backup). While a document is open the app
//! writes a copy of it, every few minutes when it has changed, to a backup folder in the app's data
//! folder, named after the document and this process: `HOUSING~4242.w3d`. A clean exit deletes the
//! process's own copies, so what is left at the next launch was left by a crash, and the app offers
//! to recover it.

use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;

/// A backup another run of the app left behind.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Entry {
    pub path: PathBuf,
    /// The document's name as it was shown (UNTITLED.W3D, HOUSING.W3D).
    pub document: String,
    /// When it was written, in seconds since 1970.
    pub modified: u64,
}

/// The backup file's name for a document in this process.
pub fn file_name(document: &str, pid: u32) -> String {
    let stem = document.trim().trim_end_matches(|c: char| c.is_whitespace());
    let stem = stem.strip_suffix(".W3D").or_else(|| stem.strip_suffix(".w3d")).unwrap_or(stem);
    let safe: String = stem.chars().map(|c| if c.is_alphanumeric() || "-_ .".contains(c) { c } else { '_' }).collect();
    let safe = safe.trim();
    format!("{}~{pid}.w3d", if safe.is_empty() { "UNTITLED" } else { safe })
}

/// The document and process a backup file was written for.
pub fn parse(name: &str) -> Option<(String, u32)> {
    let stem = name.strip_suffix(".w3d")?;
    let (doc, pid) = stem.rsplit_once('~')?;
    Some((format!("{doc}.W3D"), pid.parse().ok()?))
}

/// The backups in `dir` written by other processes, newest first.
pub fn list(dir: &Path, own: u32) -> Vec<Entry> {
    let mut out: Vec<Entry> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().into_string().ok()?;
            let (document, pid) = parse(&name)?;
            if pid == own { return None }
            let modified = e.metadata().ok()?.modified().ok()?.duration_since(UNIX_EPOCH).ok()?.as_secs();
            Some(Entry { path: e.path(), document, modified })
        })
        .collect();
    out.sort_by(|a, b| b.modified.cmp(&a.modified));
    out
}

/// Delete this process's backups (a clean exit, or before writing one under a new name).
pub fn clear_own(dir: &Path, own: u32) {
    for e in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        if e.file_name().to_str().and_then(parse).is_some_and(|(_, pid)| pid == own) {
            let _ = std::fs::remove_file(e.path());
        }
    }
}

/// Whether `path` is a backup file in `dir` (Recover and Discard only touch those).
pub fn is_backup(dir: &Path, path: &Path) -> bool {
    path.parent() == Some(dir) && path.file_name().and_then(|n| n.to_str()).and_then(parse).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_round_trip_and_stay_safe() {
        assert_eq!(file_name("HOUSING.W3D", 42), "HOUSING~42.w3d");
        assert_eq!(file_name("a/b:c.w3d", 7), "a_b_c~7.w3d");
        assert_eq!(file_name("  ", 7), "UNTITLED~7.w3d");
        assert_eq!(parse("HOUSING~42.w3d"), Some(("HOUSING.W3D".into(), 42)));
        assert_eq!(parse("A~B~9.w3d"), Some(("A~B.W3D".into(), 9)));
        assert_eq!(parse("notes.txt"), None);
        assert_eq!(parse("plain.w3d"), None);
    }

    #[test]
    fn lists_other_runs_newest_first_and_clears_its_own() {
        let dir = std::env::temp_dir().join(format!("w3d-backup-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("OLD~1.w3d"), b"x").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(1100));
        std::fs::write(dir.join("NEW~2.w3d"), b"x").unwrap();
        std::fs::write(dir.join("MINE~3.w3d"), b"x").unwrap();
        std::fs::write(dir.join("other.txt"), b"x").unwrap();
        let l = list(&dir, 3);
        assert_eq!(l.iter().map(|e| e.document.as_str()).collect::<Vec<_>>(), ["NEW.W3D", "OLD.W3D"]);
        assert!(is_backup(&dir, &l[0].path));
        assert!(!is_backup(&dir, &dir.join("other.txt")));
        assert!(!is_backup(&dir, Path::new("/etc/NEW~2.w3d")));
        clear_own(&dir, 3);
        assert!(!dir.join("MINE~3.w3d").exists() && dir.join("NEW~2.w3d").exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
