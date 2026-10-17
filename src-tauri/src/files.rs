use serde::Serialize;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

/// Files larger than this are shown truncated in the code viewer.
const MAX_READ: u64 = 2 * 1024 * 1024;
/// Upper bound on the quick-open index for non-git folders.
const MAX_INDEX: usize = 20_000;

#[derive(Serialize)]
pub struct DirEntry {
    pub name: String,
    /// path relative to the browsed root, always with `/` separators
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
}

#[derive(Serialize)]
pub struct FileContent {
    pub path: String,
    pub content: String,
    pub size: u64,
    pub binary: bool,
    pub truncated: bool,
}

/// Join `rel` onto `root` and make sure the result stays inside `root`
/// (no `..` or symlink escapes).
fn resolve_inside(root: &str, rel: &str) -> Result<PathBuf, String> {
    let root = fs::canonicalize(root).map_err(|e| format!("{root}: {e}"))?;
    let rel = rel.trim_start_matches(['/', '\\']);
    let target = if rel.is_empty() {
        root.clone()
    } else {
        fs::canonicalize(root.join(rel)).map_err(|e| format!("{rel}: {e}"))?
    };
    if !target.starts_with(&root) {
        return Err(format!("{rel} is outside the workspace"));
    }
    Ok(target)
}

fn rel_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

#[tauri::command]
pub fn list_dir(root: String, rel: String) -> Result<Vec<DirEntry>, String> {
    let base = fs::canonicalize(&root).map_err(|e| e.to_string())?;
    let dir = resolve_inside(&root, &rel)?;
    let mut entries: Vec<DirEntry> = fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .filter(|e| e.file_name() != ".git")
        .filter_map(|e| {
            let meta = e.metadata().ok()?;
            Some(DirEntry {
                name: e.file_name().to_string_lossy().into_owned(),
                path: rel_path(&base, &e.path()),
                is_dir: meta.is_dir(),
                size: if meta.is_dir() { 0 } else { meta.len() },
            })
        })
        .collect();
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

#[tauri::command]
pub fn read_text_file(root: String, rel: String) -> Result<FileContent, String> {
    let path = resolve_inside(&root, &rel)?;
    if path.is_dir() {
        return Err(format!("{rel} is a folder"));
    }
    let size = fs::metadata(&path).map_err(|e| e.to_string())?.len();
    let mut bytes = Vec::with_capacity(size.min(MAX_READ) as usize);
    fs::File::open(&path)
        .map_err(|e| e.to_string())?
        .take(MAX_READ)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    let binary = bytes.iter().take(8192).any(|&b| b == 0);
    Ok(FileContent {
        path: rel,
        content: if binary {
            String::new()
        } else {
            String::from_utf8_lossy(&bytes).into_owned()
        },
        size,
        binary,
        truncated: size > MAX_READ,
    })
}

fn walk(root: &Path, dir: &Path, out: &mut Vec<String>) {
    if out.len() >= MAX_INDEX {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let path = entry.path();
        if path.is_dir() {
            if !name.starts_with('.') && !super::git::SKIP_DIRS.contains(&name.as_str()) {
                walk(root, &path, out);
            }
        } else {
            out.push(rel_path(root, &path));
            if out.len() >= MAX_INDEX {
                return;
            }
        }
    }
}

/// Every file under `root` for quick open: git's view (tracked + untracked,
/// minus ignored) inside a repo, otherwise a bounded directory walk.
#[tauri::command]
pub fn list_files(root: String) -> Result<Vec<String>, String> {
    let base = fs::canonicalize(&root).map_err(|e| e.to_string())?;
    let is_repo_root = base.join(".git").exists();
    if is_repo_root {
        if let Ok(out) = super::git::run_git(
            &root,
            &["ls-files", "--cached", "--others", "--exclude-standard"],
        ) {
            let mut files: Vec<String> = out.lines().map(str::to_string).collect();
            files.dedup();
            return Ok(files);
        }
    }
    let mut files = Vec::new();
    walk(&base, &base, &mut files);
    files.sort();
    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_tree() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("vide-files-{}", fastrand::u64(..)));
        fs::create_dir_all(dir.join("src/nested")).unwrap();
        fs::create_dir_all(dir.join("node_modules/pkg")).unwrap();
        fs::write(dir.join("src/main.rs"), "fn main() {}\n").unwrap();
        fs::write(dir.join("src/nested/a.txt"), "a").unwrap();
        fs::write(dir.join("README.md"), "# hi").unwrap();
        fs::write(dir.join("logo.bin"), [0u8, 1, 2, 3]).unwrap();
        fs::write(dir.join("node_modules/pkg/index.js"), "x").unwrap();
        dir
    }

    #[test]
    fn list_dir_puts_folders_first_with_relative_paths() {
        let root = temp_tree();
        let r = root.to_string_lossy().to_string();
        let top = list_dir(r.clone(), String::new()).unwrap();
        assert!(top[0].is_dir);
        let names: Vec<_> = top.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, ["node_modules", "src", "logo.bin", "README.md"]);
        let nested = list_dir(r, "src".into()).unwrap();
        assert_eq!(nested[0].path, "src/nested");
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn reads_text_and_flags_binary() {
        let root = temp_tree();
        let r = root.to_string_lossy().to_string();
        let text = read_text_file(r.clone(), "src/main.rs".into()).unwrap();
        assert_eq!(text.content, "fn main() {}\n");
        assert!(!text.binary && !text.truncated);
        let bin = read_text_file(r, "logo.bin".into()).unwrap();
        assert!(bin.binary);
        assert!(bin.content.is_empty());
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn rejects_paths_outside_the_root() {
        let root = temp_tree();
        let r = root.join("src").to_string_lossy().to_string();
        assert!(read_text_file(r.clone(), "../README.md".into()).is_err());
        assert!(list_dir(r, "..".into()).is_err());
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn index_walk_skips_dependency_folders() {
        let root = temp_tree();
        let files = list_files(root.to_string_lossy().to_string()).unwrap();
        assert!(files.contains(&"src/nested/a.txt".to_string()));
        assert!(!files.iter().any(|f| f.starts_with("node_modules")));
        fs::remove_dir_all(root).ok();
    }
}
