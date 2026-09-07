use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn git_command(repo: &str) -> Command {
    let mut cmd = Command::new("git");
    cmd.current_dir(repo);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

fn run_git(repo: &str, args: &[&str]) -> Result<String, String> {
    let output = git_command(repo)
        .args(args)
        .output()
        .map_err(|e| format!("failed to run git: {e}"))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
        let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
        let msg = if stderr.trim().is_empty() {
            stdout
        } else {
            stderr
        };
        Err(msg.trim().to_string())
    }
}

fn current_branch(repo: &str) -> String {
    run_git(repo, &["rev-parse", "--abbrev-ref", "HEAD"])
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|_| "(no commits)".to_string())
}

fn ahead_behind(repo: &str) -> (u32, u32) {
    match run_git(
        repo,
        &["rev-list", "--left-right", "--count", "@{u}...HEAD"],
    ) {
        Ok(out) => {
            let mut parts = out.split_whitespace();
            let behind = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
            let ahead = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
            (ahead, behind)
        }
        Err(_) => (0, 0),
    }
}

#[derive(Serialize)]
pub struct RepoInfo {
    pub name: String,
    pub path: String,
    pub branch: String,
    pub changed_files: u32,
    pub ahead: u32,
    pub behind: u32,
}

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
    ".vscode",
    "bin",
    "obj",
];

fn find_repo_dirs(dir: &Path, depth: u32, found: &mut Vec<PathBuf>) {
    // a folder can be a repo AND contain nested repos (e.g. a git-inited
    // parent folder holding real project repos) — keep descending either way
    if dir.join(".git").exists() {
        found.push(dir.to_path_buf());
    }
    if depth == 0 {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || SKIP_DIRS.contains(&name.as_str()) {
            continue;
        }
        find_repo_dirs(&path, depth - 1, found);
    }
}

fn repo_info(path: &Path) -> RepoInfo {
    let path_str = path.to_string_lossy().to_string();
    let changed = run_git(&path_str, &["status", "--porcelain"])
        .map(|s| s.lines().count() as u32)
        .unwrap_or(0);
    let (ahead, behind) = ahead_behind(&path_str);
    RepoInfo {
        name: path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| path_str.clone()),
        branch: current_branch(&path_str),
        changed_files: changed,
        ahead,
        behind,
        path: path_str,
    }
}

#[tauri::command]
pub fn scan_repos(root: String) -> Result<Vec<RepoInfo>, String> {
    let root_path = Path::new(&root);
    if !root_path.is_dir() {
        return Err(format!("{root} is not a directory"));
    }
    let mut dirs = Vec::new();
    find_repo_dirs(root_path, 3, &mut dirs);
    dirs.sort();
    Ok(dirs.iter().map(|d| repo_info(d)).collect())
}

#[tauri::command]
pub fn refresh_repo(path: String) -> Result<RepoInfo, String> {
    Ok(repo_info(Path::new(&path)))
}

#[derive(Serialize)]
pub struct FileStatus {
    pub path: String,
    pub orig_path: Option<String>,
    pub index_status: String,
    pub worktree_status: String,
}

#[derive(Serialize)]
pub struct RepoStatus {
    pub branch: String,
    pub ahead: u32,
    pub behind: u32,
    pub files: Vec<FileStatus>,
}

#[tauri::command]
pub fn repo_status(path: String) -> Result<RepoStatus, String> {
    let out = run_git(&path, &["status", "--porcelain"])?;
    let mut files = Vec::new();
    for line in out.lines() {
        if line.len() < 4 {
            continue;
        }
        let index_status = line[0..1].to_string();
        let worktree_status = line[1..2].to_string();
        let rest = line[3..].trim();
        let unquote = |s: &str| s.trim_matches('"').to_string();
        let (file_path, orig_path) = match rest.split_once(" -> ") {
            Some((from, to)) => (unquote(to), Some(unquote(from))),
            None => (unquote(rest), None),
        };
        files.push(FileStatus {
            path: file_path,
            orig_path,
            index_status,
            worktree_status,
        });
    }
    let (ahead, behind) = ahead_behind(&path);
    Ok(RepoStatus {
        branch: current_branch(&path),
        ahead,
        behind,
        files,
    })
}

#[derive(Serialize)]
pub struct BranchInfo {
    pub name: String,
    pub is_current: bool,
    pub upstream: Option<String>,
    pub last_subject: String,
    pub last_date: String,
}

#[derive(Serialize)]
pub struct Branches {
    pub current: String,
    pub locals: Vec<BranchInfo>,
    pub remotes: Vec<String>,
}

#[tauri::command]
pub fn list_branches(path: String) -> Result<Branches, String> {
    let current = current_branch(&path);
    let out = run_git(
        &path,
        &[
            "for-each-ref",
            "refs/heads",
            "--sort=-committerdate",
            "--format=%(refname:short)\x1f%(upstream:short)\x1f%(subject)\x1f%(committerdate:relative)",
        ],
    )?;
    let locals = out
        .lines()
        .filter_map(|line| {
            let mut parts = line.split('\x1f');
            let name = parts.next()?.to_string();
            let upstream = parts.next().unwrap_or("").to_string();
            let subject = parts.next().unwrap_or("").to_string();
            let date = parts.next().unwrap_or("").to_string();
            Some(BranchInfo {
                is_current: name == current,
                upstream: if upstream.is_empty() {
                    None
                } else {
                    Some(upstream)
                },
                last_subject: subject,
                last_date: date,
                name,
            })
        })
        .collect();
    let remotes_out = run_git(
        &path,
        &["for-each-ref", "refs/remotes", "--format=%(refname:short)"],
    )
    .unwrap_or_default();
    let remotes = remotes_out
        .lines()
        .filter(|l| !l.ends_with("/HEAD"))
        .map(|l| l.to_string())
        .collect();
    Ok(Branches {
        current,
        locals,
        remotes,
    })
}

#[tauri::command]
pub fn checkout_branch(path: String, branch: String) -> Result<String, String> {
    run_git(&path, &["switch", &branch])
}

#[tauri::command]
pub fn create_branch(path: String, name: String) -> Result<String, String> {
    run_git(&path, &["switch", "-c", &name])
}

#[tauri::command]
pub fn delete_branch(path: String, name: String, force: bool) -> Result<String, String> {
    let flag = if force { "-D" } else { "-d" };
    run_git(&path, &["branch", flag, &name])
}

#[tauri::command]
pub fn stage_file(path: String, file: String) -> Result<String, String> {
    run_git(&path, &["add", "--", &file])
}

#[tauri::command]
pub fn unstage_file(path: String, file: String) -> Result<String, String> {
    run_git(&path, &["restore", "--staged", "--", &file])
}

#[tauri::command]
pub fn stage_all(path: String) -> Result<String, String> {
    run_git(&path, &["add", "-A"])
}

#[tauri::command]
pub fn discard_file(path: String, file: String, untracked: bool) -> Result<String, String> {
    if untracked {
        let full = Path::new(&path).join(&file);
        if full.is_dir() {
            fs::remove_dir_all(&full).map_err(|e| e.to_string())?;
        } else {
            fs::remove_file(&full).map_err(|e| e.to_string())?;
        }
        Ok(String::new())
    } else {
        run_git(&path, &["restore", "--", &file])
    }
}

#[tauri::command]
pub fn commit(path: String, message: String) -> Result<String, String> {
    run_git(&path, &["commit", "-m", &message])
}

/// Unified patch for one file (or the whole tree when `file` is None).
/// Untracked files get a synthesized all-additions patch since `git diff`
/// doesn't cover them.
#[tauri::command]
pub fn get_diff(
    path: String,
    file: Option<String>,
    staged: bool,
    untracked: bool,
) -> Result<String, String> {
    if untracked {
        let file = file.ok_or("untracked diff requires a file")?;
        let full = Path::new(&path).join(&file);
        let bytes = fs::read(&full).map_err(|e| e.to_string())?;
        if bytes.contains(&0) {
            return Ok(format!("diff --git a/{file} b/{file}\nBinary file (new)\n"));
        }
        let content = String::from_utf8_lossy(&bytes);
        let lines: Vec<&str> = content.lines().collect();
        let mut patch = format!(
            "diff --git a/{file} b/{file}\nnew file mode 100644\n--- /dev/null\n+++ b/{file}\n@@ -0,0 +1,{} @@\n",
            lines.len()
        );
        for line in &lines {
            patch.push('+');
            patch.push_str(line);
            patch.push('\n');
        }
        return Ok(patch);
    }
    let mut args: Vec<&str> = vec!["diff"];
    if staged {
        args.push("--cached");
    }
    if let Some(f) = file.as_deref() {
        args.push("--");
        args.push(f);
    }
    run_git(&path, &args)
}

#[derive(Serialize)]
pub struct CommitEntry {
    pub sha: String,
    pub short_sha: String,
    pub subject: String,
    pub author: String,
    pub date: String,
    pub refs: String,
}

#[tauri::command]
pub fn commit_log(path: String, limit: u32) -> Result<Vec<CommitEntry>, String> {
    let count = format!("-{limit}");
    let out = run_git(
        &path,
        &["log", &count, "--format=%H\x1f%h\x1f%s\x1f%an\x1f%ar\x1f%D"],
    )?;
    Ok(out
        .lines()
        .filter_map(|line| {
            let mut p = line.split('\x1f');
            Some(CommitEntry {
                sha: p.next()?.to_string(),
                short_sha: p.next().unwrap_or("").to_string(),
                subject: p.next().unwrap_or("").to_string(),
                author: p.next().unwrap_or("").to_string(),
                date: p.next().unwrap_or("").to_string(),
                refs: p.next().unwrap_or("").to_string(),
            })
        })
        .collect())
}

#[tauri::command]
pub fn commit_diff(path: String, sha: String) -> Result<String, String> {
    run_git(&path, &["show", "--patch", "--format=", &sha])
}

/// True when the repo is stuck mid-rebase (conflict or interrupted).
#[tauri::command]
pub fn rebase_in_progress(path: String) -> Result<bool, String> {
    let base = Path::new(&path);
    for dir in ["rebase-merge", "rebase-apply"] {
        let rel = run_git(&path, &["rev-parse", "--git-path", dir])?;
        // --git-path output is relative to the repo root (or absolute)
        if base.join(rel.trim()).exists() {
            return Ok(true);
        }
    }
    Ok(false)
}

#[tauri::command]
pub fn abort_rebase(path: String) -> Result<String, String> {
    run_git(&path, &["rebase", "--abort"])
}

#[tauri::command]
pub fn git_fetch(path: String) -> Result<String, String> {
    run_git(&path, &["fetch", "--all", "--prune"])
}

#[tauri::command]
pub fn git_pull(path: String) -> Result<String, String> {
    run_git(&path, &["pull"])
}

#[tauri::command]
pub fn git_push(path: String) -> Result<String, String> {
    // set upstream automatically for new branches
    match run_git(&path, &["push"]) {
        Ok(out) => Ok(out),
        Err(err) if err.contains("--set-upstream") => {
            let branch = current_branch(&path);
            run_git(&path, &["push", "--set-upstream", "origin", &branch])
        }
        Err(err) => Err(err),
    }
}
