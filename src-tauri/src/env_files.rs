use std::fs;
use std::path::{Path, PathBuf};

const SKIP_DIRS: &[&str] = &[
    "node_modules",
    "target",
    "dist",
    "build",
    "out",
    "vendor",
    ".git",
    "__pycache__",
    ".next",
    ".nuxt",
    ".gradle",
    ".idea",
    "bin",
    "obj",
];

fn is_env_file(name: &str) -> bool {
    name.starts_with(".env") || name.ends_with(".env")
}

fn walk(dir: &Path, root: &Path, depth: u32, out: &mut Vec<String>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if path.is_file() && is_env_file(&name) {
            if let Ok(rel) = path.strip_prefix(root) {
                out.push(rel.to_string_lossy().replace('\\', "/"));
            }
        } else if path.is_dir() && depth > 0 {
            if name.starts_with('.') || SKIP_DIRS.contains(&name.as_str()) {
                continue;
            }
            walk(&path, root, depth - 1, out);
        }
    }
}

#[tauri::command]
pub fn list_env_files(path: String) -> Result<Vec<String>, String> {
    let root = Path::new(&path);
    if !root.is_dir() {
        return Err(format!("{path} is not a directory"));
    }
    let mut out = Vec::new();
    walk(root, root, 2, &mut out);
    out.sort();
    Ok(out)
}

/// Only allow relative paths inside the repo whose file name looks like an
/// env file — these commands can read and write, so keep the scope tight.
fn resolve(repo: &str, rel: &str) -> Result<PathBuf, String> {
    let p = Path::new(rel);
    if p.is_absolute() || rel.split(['/', '\\']).any(|part| part == "..") {
        return Err("invalid path".into());
    }
    let name = p
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("invalid file name")?;
    if !is_env_file(name) {
        return Err("not an env file".into());
    }
    Ok(Path::new(repo).join(p))
}

#[tauri::command]
pub fn read_env_file(path: String, file: String) -> Result<String, String> {
    let full = resolve(&path, &file)?;
    fs::read_to_string(&full).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_env_file(path: String, file: String, content: String) -> Result<(), String> {
    let full = resolve(&path, &file)?;
    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&full, content).map_err(|e| e.to_string())
}
