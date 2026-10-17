use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};

const MAX_LINE_CHARS: usize = 4000;
const BATCH_MAX_LINES: usize = 500;
const BATCH_MAX_AGE: Duration = Duration::from_millis(80);
const WATCH_SCAN_INTERVAL: Duration = Duration::from_millis(350);
const WATCH_DEBOUNCE: Duration = Duration::from_millis(500);
const IGNORED_WATCH_DIRECTORIES: &[&str] = &[
    ".cache",
    ".git",
    ".next",
    ".nuxt",
    ".open-next",
    ".svelte-kit",
    ".turbo",
    ".vercel",
    ".wrangler",
    "build",
    "coverage",
    "dist",
    "node_modules",
    "out",
    "target",
];

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Default)]
pub struct ProcessManager {
    pub running: Mutex<HashMap<String, u32>>,
    /// command and folder of each running process, so the next launch can
    /// offer to start them again
    specs: Mutex<HashMap<String, RunSpec>>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct RunSpec {
    pub id: String,
    pub command: String,
    pub cwd: String,
}

const LAST_SESSION_FILE: &str = "last-session.json";

impl ProcessManager {
    /// Kill every tracked process tree — called when the app exits so dev
    /// servers don't linger as orphans.
    pub fn kill_all(&self) {
        let pids: Vec<u32> = self.running.lock().unwrap().values().copied().collect();
        for pid in pids {
            let _ = kill_tree(pid);
        }
    }

    /// Remember what is running (call before `kill_all`) so the next launch
    /// can offer to resume it. Skipped when nothing runs, so a second call
    /// after the processes are gone cannot erase the saved list.
    pub fn save_session(&self, app: &AppHandle) {
        let mut specs: Vec<RunSpec> = self.specs.lock().unwrap().values().cloned().collect();
        if specs.is_empty() {
            return;
        }
        specs.sort_by(|a, b| a.id.cmp(&b.id));
        if let Ok(dir) = app.path().app_config_dir() {
            let _ = fs::create_dir_all(&dir);
            let _ = fs::write(
                dir.join(LAST_SESSION_FILE),
                serde_json::to_string_pretty(&specs).unwrap_or_default(),
            );
        }
    }
}

/// Runs that were active when the app last closed or updated; reading them
/// clears the list so the offer appears once.
#[tauri::command]
pub fn take_last_session(app: AppHandle) -> Vec<RunSpec> {
    let Ok(dir) = app.path().app_config_dir() else {
        return Vec::new();
    };
    let path = dir.join(LAST_SESSION_FILE);
    let specs = fs::read_to_string(&path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default();
    let _ = fs::remove_file(&path);
    specs
}

#[derive(Debug, Default, PartialEq, Eq)]
struct ChangeSnapshot(HashMap<PathBuf, FileStamp>);

#[derive(Debug, PartialEq, Eq)]
struct FileStamp {
    len: u64,
    modified_nanos: u128,
}

fn snapshot_tree(root: &Path) -> ChangeSnapshot {
    fn visit(directory: &Path, files: &mut HashMap<PathBuf, FileStamp>) {
        let Ok(entries) = fs::read_dir(directory) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_symlink() {
                continue;
            }
            if file_type.is_dir() {
                let name = entry.file_name();
                if IGNORED_WATCH_DIRECTORIES
                    .iter()
                    .any(|ignored| name.eq_ignore_ascii_case(ignored))
                {
                    continue;
                }
                visit(&path, files);
            } else if file_type.is_file() {
                let Ok(metadata) = entry.metadata() else {
                    continue;
                };
                let modified_nanos = metadata
                    .modified()
                    .ok()
                    .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|duration| duration.as_nanos())
                    .unwrap_or_default();
                files.insert(
                    path,
                    FileStamp {
                        len: metadata.len(),
                        modified_nanos,
                    },
                );
            }
        }
    }

    let mut files = HashMap::new();
    visit(root, &mut files);
    ChangeSnapshot(files)
}

/// Paths that differ between two snapshots: added, removed or modified.
fn changed_paths(before: &ChangeSnapshot, after: &ChangeSnapshot) -> Vec<PathBuf> {
    let mut changed: Vec<PathBuf> = after
        .0
        .iter()
        .filter(|(path, stamp)| before.0.get(*path) != Some(*stamp))
        .map(|(path, _)| path.clone())
        .collect();
    changed.extend(
        before
            .0
            .keys()
            .filter(|path| !after.0.contains_key(*path))
            .cloned(),
    );
    changed
}

/// The subset of `paths` that git ignores (per the repo's .gitignore files).
/// Build output, logs, caches and tool state usually live there, and changes
/// to them should never restart a dev server. Outside a git repo, or if git is
/// unavailable, nothing is treated as ignored.
fn git_ignored(root: &Path, paths: &[PathBuf]) -> HashSet<PathBuf> {
    use std::io::Write;
    if paths.is_empty() {
        return HashSet::new();
    }
    // fs::canonicalize gives `\\?\C:\...` on Windows, which git does not
    // accept; hand git a plain root and root-relative, slash-separated paths.
    let plain_root = PathBuf::from(
        root.to_string_lossy()
            .trim_start_matches(r"\\?\")
            .to_string(),
    );
    let relative: Vec<(String, PathBuf)> = paths
        .iter()
        .filter_map(|path| {
            path.strip_prefix(root)
                .ok()
                .map(|rel| (rel.to_string_lossy().replace('\\', "/"), path.clone()))
        })
        .collect();
    if relative.is_empty() {
        return HashSet::new();
    }
    let mut command = Command::new("git");
    command
        .arg("-C")
        .arg(&plain_root)
        .args(["check-ignore", "--stdin", "-z"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    let Ok(mut child) = command.spawn() else {
        return HashSet::new();
    };
    if let Some(mut stdin) = child.stdin.take() {
        let mut input = Vec::new();
        for (rel, _) in &relative {
            input.extend_from_slice(rel.as_bytes());
            input.push(0);
        }
        let _ = stdin.write_all(&input);
    }
    let Ok(output) = child.wait_with_output() else {
        return HashSet::new();
    };
    let ignored: HashSet<String> = output
        .stdout
        .split(|byte| *byte == 0)
        .filter(|chunk| !chunk.is_empty())
        .map(|chunk| String::from_utf8_lossy(chunk).into_owned())
        .collect();
    relative
        .into_iter()
        .filter(|(rel, _)| ignored.contains(rel))
        .map(|(_, path)| path)
        .collect()
}

/// Whether the settled tree differs from the last baseline in a way that
/// should restart: something actually changed (a temp file that appeared and
/// vanished again does not count) and not every change is git-ignored.
fn should_restart(root: &Path, baseline: &ChangeSnapshot, settled: &ChangeSnapshot) -> bool {
    let changed = changed_paths(baseline, settled);
    if changed.is_empty() {
        return false;
    }
    let ignored = git_ignored(root, &changed);
    changed.iter().any(|path| !ignored.contains(path))
}

struct WatchHandle {
    session_ids: Arc<Mutex<HashSet<String>>>,
    stop: Arc<AtomicBool>,
}

#[derive(Default)]
struct WatchState {
    roots: HashMap<PathBuf, WatchHandle>,
    session_roots: HashMap<String, PathBuf>,
}

#[derive(Default)]
pub struct WatchManager {
    state: Mutex<WatchState>,
}

impl WatchManager {
    fn detach_session(state: &mut WatchState, id: &str) {
        let Some(root) = state.session_roots.remove(id) else {
            return;
        };
        let remove_root = state.roots.get(&root).is_some_and(|handle| {
            let mut ids = handle.session_ids.lock().unwrap();
            ids.remove(id);
            ids.is_empty()
        });
        if remove_root {
            if let Some(handle) = state.roots.remove(&root) {
                handle.stop.store(true, Ordering::Relaxed);
            }
        }
    }

    pub fn stop_all(&self) {
        let mut state = self.state.lock().unwrap();
        for handle in state.roots.values() {
            handle.stop.store(true, Ordering::Relaxed);
        }
        state.roots.clear();
        state.session_roots.clear();
    }
}

#[derive(Serialize, Clone)]
struct RunChangeEvent {
    ids: Vec<String>,
}

#[tauri::command]
pub fn watch_run_changes(
    app: AppHandle,
    state: State<'_, WatchManager>,
    id: String,
    path: String,
) -> Result<(), String> {
    let root = fs::canonicalize(&path).map_err(|e| format!("cannot watch `{path}`: {e}"))?;
    if !root.is_dir() {
        return Err(format!("cannot watch `{path}`: not a directory"));
    }

    let mut watch_state = state.state.lock().unwrap();
    if watch_state.session_roots.get(&id) == Some(&root) {
        return Ok(());
    }
    WatchManager::detach_session(&mut watch_state, &id);

    if let Some(handle) = watch_state.roots.get(&root) {
        handle.session_ids.lock().unwrap().insert(id.clone());
        watch_state.session_roots.insert(id, root);
        return Ok(());
    }

    let session_ids = Arc::new(Mutex::new(HashSet::from([id.clone()])));
    let stop = Arc::new(AtomicBool::new(false));
    watch_state.roots.insert(
        root.clone(),
        WatchHandle {
            session_ids: session_ids.clone(),
            stop: stop.clone(),
        },
    );
    watch_state.session_roots.insert(id, root.clone());
    drop(watch_state);

    std::thread::spawn(move || {
        let mut snapshot = snapshot_tree(&root);
        // State as of the last restart (or watch start). Restarts are decided
        // against this, not against the previous scan, so churn that settles
        // back to the same tree (temp files) is not a change.
        let mut baseline = snapshot_tree(&root);
        let mut changed_at: Option<Instant> = None;
        while !stop.load(Ordering::Relaxed) {
            std::thread::sleep(WATCH_SCAN_INTERVAL);
            let next = snapshot_tree(&root);
            if next != snapshot {
                snapshot = next;
                changed_at = Some(Instant::now());
                continue;
            }
            if changed_at.is_some_and(|at| at.elapsed() >= WATCH_DEBOUNCE) {
                changed_at = None;
                if should_restart(&root, &baseline, &snapshot) {
                    let ids = session_ids.lock().unwrap().iter().cloned().collect();
                    let _ = app.emit("run-change", RunChangeEvent { ids });
                }
                baseline = snapshot_tree(&root);
                snapshot = snapshot_tree(&root);
            }
        }
    });
    Ok(())
}

#[tauri::command]
pub fn unwatch_run_changes(state: State<'_, WatchManager>, id: String) {
    WatchManager::detach_session(&mut state.state.lock().unwrap(), &id);
}

#[derive(Serialize, Clone)]
pub struct DetectedConfig {
    pub name: String,
    pub command: String,
    pub cwd: String,
    pub source: String,
}

fn package_manager_for(dir: &Path) -> &'static str {
    if dir.join("pnpm-lock.yaml").exists() {
        "pnpm"
    } else if dir.join("yarn.lock").exists() {
        "yarn"
    } else if dir.join("bun.lockb").exists() || dir.join("bun.lock").exists() {
        "bun"
    } else {
        "npm"
    }
}

fn detect_in_dir(dir: &Path, repo_root: &Path, configs: &mut Vec<DetectedConfig>) {
    let rel = dir
        .strip_prefix(repo_root)
        .ok()
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .filter(|s| !s.is_empty());
    let label = |name: &str| match &rel {
        Some(r) => format!("{r} · {name}"),
        None => name.to_string(),
    };
    let cwd = dir.to_string_lossy().to_string();

    let pkg_json = dir.join("package.json");
    if pkg_json.exists() {
        // lockfile may live at the repo root in a monorepo
        let pm = if package_manager_for(dir) != "npm" {
            package_manager_for(dir)
        } else {
            package_manager_for(repo_root)
        };
        if let Ok(text) = fs::read_to_string(&pkg_json) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                if let Some(scripts) = json.get("scripts").and_then(|s| s.as_object()) {
                    for (script, _) in scripts {
                        configs.push(DetectedConfig {
                            name: label(script),
                            command: format!("{pm} run {script}"),
                            cwd: cwd.clone(),
                            source: "package.json".into(),
                        });
                    }
                }
            }
        }
    }

    if dir.join("pom.xml").exists() {
        let mvn = if dir.join("mvnw.cmd").exists() {
            "mvnw.cmd"
        } else {
            "mvn"
        };
        configs.push(DetectedConfig {
            name: label("spring-boot:run"),
            command: format!("{mvn} spring-boot:run"),
            cwd: cwd.clone(),
            source: "maven".into(),
        });
        configs.push(DetectedConfig {
            name: label("mvn package"),
            command: format!("{mvn} -DskipTests package"),
            cwd: cwd.clone(),
            source: "maven".into(),
        });
    }

    if dir.join("build.gradle").exists() || dir.join("build.gradle.kts").exists() {
        let gradle = if dir.join("gradlew.bat").exists() {
            "gradlew.bat"
        } else {
            "gradle"
        };
        configs.push(DetectedConfig {
            name: label("bootRun"),
            command: format!("{gradle} bootRun"),
            cwd: cwd.clone(),
            source: "gradle".into(),
        });
        configs.push(DetectedConfig {
            name: label("build"),
            command: format!("{gradle} build"),
            cwd: cwd.clone(),
            source: "gradle".into(),
        });
    }

    if dir.join("docker-compose.yml").exists()
        || dir.join("docker-compose.yaml").exists()
        || dir.join("compose.yaml").exists()
    {
        configs.push(DetectedConfig {
            name: label("docker compose up"),
            command: "docker compose up".into(),
            cwd: cwd.clone(),
            source: "docker".into(),
        });
    }

    if dir.join("Cargo.toml").exists() {
        configs.push(DetectedConfig {
            name: label("cargo run"),
            command: "cargo run".into(),
            cwd,
            source: "cargo".into(),
        });
    }
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
    "bin",
    "obj",
];

fn walk_packages(dir: &Path, repo_root: &Path, depth: u32, configs: &mut Vec<DetectedConfig>) {
    detect_in_dir(dir, repo_root, configs);
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
        // nested git repos are their own entry in the sidebar with their own
        // run configs — don't list their scripts under the parent too
        if path.join(".git").exists() {
            continue;
        }
        walk_packages(&path, repo_root, depth - 1, configs);
    }
}

#[derive(Serialize, Debug, PartialEq)]
pub struct MissingDeps {
    /// folder with a package.json and lockfile but no node_modules
    pub cwd: String,
    pub manager: &'static str,
    pub command: &'static str,
}

/// The install command matching a folder's lockfile; no lockfile means we
/// can't tell which package manager the project expects, so stay quiet.
fn install_command(dir: &Path) -> Option<(&'static str, &'static str)> {
    if dir.join("pnpm-lock.yaml").is_file() {
        Some(("pnpm", "pnpm install"))
    } else if dir.join("yarn.lock").is_file() {
        Some(("yarn", "yarn install"))
    } else if dir.join("bun.lockb").is_file() || dir.join("bun.lock").is_file() {
        Some(("bun", "bun install"))
    } else if dir.join("package-lock.json").is_file() {
        Some(("npm", "npm install"))
    } else {
        None
    }
}

fn find_missing_deps(dir: &Path, depth: u32, out: &mut Vec<MissingDeps>) {
    if dir.join("package.json").is_file() && !dir.join("node_modules").is_dir() {
        if let Some((manager, command)) = install_command(dir) {
            out.push(MissingDeps {
                cwd: dir.to_string_lossy().into_owned(),
                manager,
                command,
            });
        }
    }
    if depth == 0 {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if !path.is_dir()
            || name.starts_with('.')
            || SKIP_DIRS.contains(&name.as_str())
            || path.join(".git").exists()
        {
            continue;
        }
        find_missing_deps(&path, depth - 1, out);
    }
}

/// JavaScript projects in the repo whose dependencies were never installed
/// (fresh clone, or a project an agent just created).
#[tauri::command]
pub fn missing_dependencies(path: String) -> Vec<MissingDeps> {
    let mut out = Vec::new();
    find_missing_deps(Path::new(&path), 2, &mut out);
    out
}

#[tauri::command]
pub fn detect_run_configs(path: String) -> Result<Vec<DetectedConfig>, String> {
    let root = Path::new(&path);
    if !root.is_dir() {
        return Err(format!("{path} is not a directory"));
    }
    let mut configs = Vec::new();
    walk_packages(root, root, 2, &mut configs);
    Ok(configs)
}

#[derive(Serialize, Clone)]
struct OutputLine {
    line: String,
    stream: &'static str,
}

#[derive(Serialize, Clone)]
struct OutputBatch {
    id: String,
    lines: Vec<OutputLine>,
}

#[derive(Serialize, Clone)]
struct ExitEvent {
    id: String,
    code: Option<i32>,
}

fn spawn_reader<R: Read + Send + 'static>(
    tx: mpsc::Sender<(&'static str, String)>,
    stream: &'static str,
    reader: R,
) {
    std::thread::spawn(move || {
        let mut buf = BufReader::new(reader);
        let mut bytes = Vec::new();
        loop {
            bytes.clear();
            match buf.read_until(b'\n', &mut bytes) {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    let mut line = String::from_utf8_lossy(&bytes)
                        .trim_end_matches(['\r', '\n'])
                        .to_string();
                    // a single megabyte-long line (bundler progress spam) would
                    // bloat memory and stall rendering — clamp it
                    if line.chars().count() > MAX_LINE_CHARS {
                        line = line.chars().take(MAX_LINE_CHARS).collect::<String>()
                            + "… [line truncated]";
                    }
                    if tx.send((stream, line)).is_err() {
                        break;
                    }
                }
            }
        }
    });
}

/// Drain reader output into batches so the UI gets a few events per second
/// instead of one IPC round-trip per line.
fn spawn_batcher(app: AppHandle, id: String, rx: mpsc::Receiver<(&'static str, String)>) {
    std::thread::spawn(move || {
        let flush = |batch: &mut Vec<OutputLine>| {
            if batch.is_empty() {
                return;
            }
            // Record lines in the agent output buffer (if available)
            if let Some(agent) = app.try_state::<Arc<super::agent::AgentState>>() {
                for line in batch.iter() {
                    let prefixed = match line.stream {
                        "stderr" => format!("[stderr] {}", line.line),
                        _ => line.line.clone(),
                    };
                    agent.record_output(&id, prefixed);
                }
            }
            let lines = std::mem::take(batch);
            let _ = app.emit(
                "run-output",
                OutputBatch {
                    id: id.clone(),
                    lines,
                },
            );
        };

        let mut batch: Vec<OutputLine> = Vec::new();
        let mut oldest = Instant::now();
        loop {
            match rx.recv_timeout(BATCH_MAX_AGE) {
                Ok((stream, line)) => {
                    if batch.is_empty() {
                        oldest = Instant::now();
                    }
                    batch.push(OutputLine { line, stream });
                    while batch.len() < BATCH_MAX_LINES {
                        match rx.try_recv() {
                            Ok((s, l)) => batch.push(OutputLine { line: l, stream: s }),
                            Err(_) => break,
                        }
                    }
                    if batch.len() >= BATCH_MAX_LINES || oldest.elapsed() >= BATCH_MAX_AGE {
                        flush(&mut batch);
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => flush(&mut batch),
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    flush(&mut batch);
                    break;
                }
            }
        }
    });
}

#[tauri::command]
pub fn start_run(
    app: AppHandle,
    state: State<'_, ProcessManager>,
    id: String,
    cwd: String,
    command: String,
) -> Result<u32, String> {
    {
        let running = state.running.lock().unwrap();
        if running.contains_key(&id) {
            return Err("this run is already active".into());
        }
    }

    #[cfg(windows)]
    let mut cmd = {
        let mut c = Command::new("cmd");
        c.args(["/C", &command]);
        c.creation_flags(CREATE_NO_WINDOW);
        c
    };
    #[cfg(not(windows))]
    let mut cmd = {
        let mut c = Command::new("sh");
        c.args(["-c", &command]);
        c
    };

    let mut child = cmd
        .current_dir(&cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to start `{command}`: {e}"))?;

    let pid = child.id();
    state.running.lock().unwrap().insert(id.clone(), pid);
    state.specs.lock().unwrap().insert(
        id.clone(),
        RunSpec {
            id: id.clone(),
            command: command.clone(),
            cwd: cwd.clone(),
        },
    );

    // Clear agent output buffer for this session id
    if let Some(agent) = app.try_state::<Arc<super::agent::AgentState>>() {
        agent.clear_output(&id);
    }

    let (tx, rx) = mpsc::channel();
    if let Some(stdout) = child.stdout.take() {
        spawn_reader(tx.clone(), "stdout", stdout);
    }
    if let Some(stderr) = child.stderr.take() {
        spawn_reader(tx.clone(), "stderr", stderr);
    }
    drop(tx); // batcher exits once both readers hang up
    spawn_batcher(app.clone(), id.clone(), rx);

    let exit_app = app.clone();
    let exit_id = id.clone();
    std::thread::spawn(move || {
        let code = child.wait().ok().and_then(|s| s.code());
        if let Some(manager) = exit_app.try_state::<ProcessManager>() {
            manager.running.lock().unwrap().remove(&exit_id);
            manager.specs.lock().unwrap().remove(&exit_id);
        }
        let _ = exit_app.emit("run-exit", ExitEvent { id: exit_id, code });
    });

    Ok(pid)
}

#[tauri::command]
pub fn stop_run(state: State<'_, ProcessManager>, id: String) -> Result<(), String> {
    let pid = {
        let running = state.running.lock().unwrap();
        running.get(&id).copied()
    };
    let Some(pid) = pid else {
        return Err("run is not active".into());
    };
    kill_tree(pid)
}

fn kill_tree(pid: u32) -> Result<(), String> {
    #[cfg(windows)]
    {
        let mut cmd = Command::new("taskkill");
        cmd.args(["/PID", &pid.to_string(), "/T", "/F"]);
        cmd.creation_flags(CREATE_NO_WINDOW);
        let out = cmd.output().map_err(|e| e.to_string())?;
        if out.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&out.stderr).into_owned())
        }
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("kill")
            .args(["-TERM", &format!("-{pid}")])
            .output();
        let _ = Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .output();
        Ok(())
    }
}

#[tauri::command]
pub fn list_running(state: State<'_, ProcessManager>) -> Vec<String> {
    state.running.lock().unwrap().keys().cloned().collect()
}

#[cfg(test)]
mod deps_tests {
    use super::missing_dependencies;
    use std::fs;

    #[test]
    fn reports_lockfile_projects_without_node_modules() {
        let root = std::env::temp_dir().join(format!("vide-deps-{}", fastrand::u64(..)));
        // root: pnpm project, not installed
        fs::create_dir_all(root.join("apps/web")).unwrap();
        fs::write(root.join("package.json"), "{}").unwrap();
        fs::write(root.join("pnpm-lock.yaml"), "").unwrap();
        // apps/web: npm project, already installed
        fs::write(root.join("apps/web/package.json"), "{}").unwrap();
        fs::write(root.join("apps/web/package-lock.json"), "{}").unwrap();
        fs::create_dir_all(root.join("apps/web/node_modules")).unwrap();
        // apps/api: package.json without a lockfile -> unknown manager, ignored
        fs::create_dir_all(root.join("apps/api")).unwrap();
        fs::write(root.join("apps/api/package.json"), "{}").unwrap();

        let found = missing_dependencies(root.to_string_lossy().into_owned());
        assert_eq!(found.len(), 1, "{found:?}");
        assert_eq!(found[0].command, "pnpm install");
        assert_eq!(std::path::Path::new(&found[0].cwd), root.as_path());
        fs::remove_dir_all(root).ok();
    }
}

#[cfg(test)]
mod tests {
    use super::{changed_paths, should_restart, snapshot_tree, ChangeSnapshot};
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir() -> std::path::PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("vibedeck-watch-{suffix}"));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn snapshot_changes_when_a_source_file_changes() {
        let root = temp_dir();
        let source = root.join("src").join("main.ts");
        fs::create_dir_all(source.parent().unwrap()).unwrap();
        fs::write(&source, "first").unwrap();
        let before = snapshot_tree(&root);

        fs::write(&source, "second version").unwrap();
        let after = snapshot_tree(&root);

        assert_ne!(before, after);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn snapshot_ignores_generated_and_dependency_directories() {
        let root = temp_dir();
        fs::write(root.join("app.ts"), "source").unwrap();
        let before = snapshot_tree(&root);

        for ignored in [".git", "node_modules", "dist", "target"] {
            let directory = root.join(ignored);
            fs::create_dir_all(&directory).unwrap();
            fs::write(directory.join("generated.txt"), ignored).unwrap();
        }

        assert_eq!(before, snapshot_tree(&root));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn transient_files_that_vanish_do_not_count_as_changes() {
        let root = temp_dir();
        fs::write(root.join("app.ts"), "source").unwrap();
        let baseline = snapshot_tree(&root);

        let temp = root.join("_tmp_1234_abcd");
        fs::write(&temp, "x").unwrap();
        assert_ne!(baseline, snapshot_tree(&root));
        fs::remove_file(&temp).unwrap();

        let settled = snapshot_tree(&root);
        assert!(changed_paths(&baseline, &settled).is_empty());
        assert!(!should_restart(&root, &baseline, &settled));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn real_edits_still_restart() {
        let root = temp_dir();
        let source = root.join("main.ts");
        fs::write(&source, "first").unwrap();
        let baseline = snapshot_tree(&root);
        fs::write(&source, "second version").unwrap();
        assert!(should_restart(&root, &baseline, &snapshot_tree(&root)));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn git_ignored_changes_do_not_restart() {
        let root = temp_dir();
        let git = std::process::Command::new("git")
            .arg("-C")
            .arg(&root)
            .args(["init", "-q"])
            .status();
        if !git.map(|s| s.success()).unwrap_or(false) {
            fs::remove_dir_all(root).unwrap();
            return; // git not available in this environment
        }
        fs::write(root.join(".gitignore"), "*.log\nstate/\n").unwrap();
        fs::create_dir_all(root.join("state")).unwrap();
        let baseline = snapshot_tree(&root);

        fs::write(root.join("server.log"), "line").unwrap();
        fs::write(root.join("state").join("cache.sqlite"), "db").unwrap();
        assert!(!should_restart(&root, &baseline, &snapshot_tree(&root)));

        fs::write(root.join("app.ts"), "code").unwrap();
        assert!(should_restart(&root, &baseline, &snapshot_tree(&root)));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn missing_watch_root_has_an_empty_snapshot() {
        let missing = temp_dir().join("missing");
        assert_eq!(snapshot_tree(&missing), ChangeSnapshot::default());
        fs::remove_dir_all(missing.parent().unwrap()).unwrap();
    }
}
