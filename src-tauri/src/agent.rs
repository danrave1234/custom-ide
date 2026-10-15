use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{Emitter, Manager};

/// Maximum number of output lines kept per session in the ring buffer.
const OUTPUT_TAIL: usize = 500;

/// Default port when not overridden by environment.
const DEFAULT_PORT: u16 = 17321;

/// Auto-generated token length.
const TOKEN_LEN: usize = 24;

#[derive(Clone, Serialize, Deserialize)]
struct AgentConfig {
    port: u16,
    token: String,
}

#[derive(Default)]
struct OutputBuffer {
    lines: Vec<String>,
}

impl OutputBuffer {
    fn push(&mut self, line: String) {
        self.lines.push(line);
        if self.lines.len() > OUTPUT_TAIL {
            self.lines.drain(0..(self.lines.len() - OUTPUT_TAIL));
        }
    }

    fn tail(&self, n: usize) -> Vec<String> {
        if n == 0 {
            self.lines.clone()
        } else if n >= self.lines.len() {
            self.lines.clone()
        } else {
            self.lines[self.lines.len() - n..].to_vec()
        }
    }
}

/// Generate a random alphanumeric token.
fn random_token(len: usize) -> String {
    const CHARS: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let mut rng = fastrand::Rng::with_seed(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos() as u64,
    );
    (0..len)
        .map(|_| CHARS[rng.u16(..CHARS.len() as u16) as usize] as char)
        .collect()
}

/// Shared state between the HTTP server thread and Tauri commands.
pub struct AgentState {
    config: Mutex<Option<AgentConfig>>,
    output: Mutex<HashMap<String, OutputBuffer>>,
}

impl AgentState {
    pub fn new() -> Self {
        Self {
            config: Mutex::new(None),
            output: Mutex::new(HashMap::new()),
        }
    }

    fn config_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
        let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        Ok(dir)
    }

    fn load_or_create_config(app: &tauri::AppHandle) -> Option<AgentConfig> {
        let dir = Self::config_dir(app).ok()?;
        let path = dir.join("agent.json");
        if path.exists() {
            if let Ok(text) = fs::read_to_string(&path) {
                if let Ok(cfg) = serde_json::from_str::<AgentConfig>(&text) {
                    return Some(cfg);
                }
            }
        }
        let mut cfg = AgentConfig {
            port: std::env::var("VIBEDECK_AGENT_PORT")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(DEFAULT_PORT),
            token: std::env::var("VIBEDECK_AGENT_TOKEN")
                .ok()
                .unwrap_or_else(|| random_token(TOKEN_LEN)),
        };
        // Allow env to override port
        if let Ok(port_str) = std::env::var("VIBEDECK_AGENT_PORT") {
            if let Ok(port) = port_str.parse() {
                cfg.port = port;
            }
        }
        if let Ok(dir) = Self::config_dir(app) {
            let path = dir.join("agent.json");
            let _ = fs::write(
                &path,
                serde_json::to_string_pretty(&cfg).unwrap_or_default(),
            );
        }
        Some(cfg)
    }

    pub fn start(app: tauri::AppHandle, state: Arc<Self>) {
        let cfg = match Self::load_or_create_config(&app) {
            Some(c) => c,
            None => return,
        };
        *state.config.lock().unwrap() = Some(cfg.clone());

        let app_clone = app.clone();
        let state_clone = state.clone();
        thread::spawn(move || {
            let bind_addr = format!("127.0.0.1:{}", cfg.port);
            match TcpListener::bind(&bind_addr) {
                Ok(listener) => {
                    let _ = app_clone.emit(
                        "agent-status",
                        json!({
                            "status": "started",
                            "port": cfg.port
                        }),
                    );
                    for stream in listener.incoming() {
                        match stream {
                            Ok(stream) => {
                                let app = app_clone.clone();
                                let state = state_clone.clone();
                                let token = cfg.token.clone();
                                thread::spawn(move || {
                                    handle_connection(stream, &app, &state, &token);
                                });
                            }
                            Err(e) => {
                                eprintln!("agent connection error: {e}");
                            }
                        }
                    }
                }
                Err(e) => {
                    eprintln!("agent server bind failed on {bind_addr}: {e}");
                    let _ = app.emit(
                        "agent-status",
                        json!({
                            "status": "error",
                            "message": format!("bind failed: {e}")
                        }),
                    );
                }
            }
        });
    }

    pub fn get_config(&self) -> Option<AgentConfig> {
        self.config.lock().unwrap().clone()
    }

    pub fn record_output(&self, session_id: &str, line: String) {
        let mut map = self.output.lock().unwrap();
        map.entry(session_id.to_string()).or_default().push(line);
    }

    pub fn clear_output(&self, session_id: &str) {
        let mut map = self.output.lock().unwrap();
        map.remove(session_id);
    }

    pub fn get_output(&self, session_id: &str, tail: usize) -> Vec<String> {
        let map = self.output.lock().unwrap();
        map.get(session_id)
            .map(|b| b.tail(tail))
            .unwrap_or_default()
    }
}

fn handle_connection(stream: TcpStream, app: &tauri::AppHandle, state: &AgentState, token: &str) {
    let mut stream = stream;
    let mut reader = BufReader::new(&mut stream);
    let mut request_line = String::new();
    if reader.read_line(&mut request_line).is_err() {
        return;
    }

    let parts: Vec<&str> = request_line.trim().split_whitespace().collect();
    if parts.len() < 2 {
        return;
    }

    let method = parts[0];
    let full_path = parts[1];

    // Read headers
    let mut content_length: usize = 0;
    let mut authorization: Option<String> = None;
    loop {
        let mut header = String::new();
        if reader.read_line(&mut header).is_err() || header.trim().is_empty() {
            break;
        }
        let lower = header.to_lowercase();
        if lower.starts_with("content-length:") {
            content_length = header
                .trim()
                .split(':')
                .nth(1)
                .and_then(|s| s.trim().parse().ok())
                .unwrap_or(0);
        }
        if lower.starts_with("authorization:") {
            authorization = Some(
                header
                    .trim()
                    .splitn(2, ':')
                    .nth(1)
                    .unwrap_or("")
                    .trim()
                    .to_string(),
            );
        }
    }

    // Read body
    let mut body = vec![0u8; content_length];
    if content_length > 0 {
        use std::io::Read;
        if reader
            .by_ref()
            .take(content_length as u64)
            .read_to_end(&mut body)
            .is_err()
        {
            return;
        }
    }
    let body_str = String::from_utf8_lossy(&body).to_string();
    let body_json: Option<Value> = if content_length > 0 {
        serde_json::from_str(&body_str).ok()
    } else {
        None
    };

    // Split path from query
    let (path, query) = full_path.split_once('?').unwrap_or((full_path, ""));

    // Auth check (skip for health)
    if path != "/health" {
        let authorized = match &authorization {
            Some(auth) => {
                // Support "Bearer <token>" or raw token
                let provided = auth.strip_prefix("Bearer ").unwrap_or(auth);
                provided == token
            }
            None => false,
        };
        if !authorized {
            send_response(stream, 401, &json!({"error": "unauthorized"}));
            return;
        }
    }

    // Route
    let (status, body) = match (method, path) {
        ("GET", "/health") => (200, json!({"status": "ok"})),
        ("GET", "/v1/status") => get_status(app),
        ("POST", "/v1/workspace/open") => post_workspace_open(&body_json, app),
        ("GET", "/v1/repos") => get_repos(app),
        ("POST", "/v1/repo/select") => post_repo_select(&body_json, app),
        ("GET", "/v1/configs") => get_configs(app, &body_json),
        ("POST", "/v1/run") => post_run(&body_json, app),
        ("POST", "/v1/run/stop") => post_run_stop(&body_json, app),
        ("GET", "/v1/runs") => get_runs(app),
        ("GET", "/v1/runs/output") => get_runs_output(query, state),
        ("POST", "/v1/view") => post_view(&body_json, app),
        ("POST", "/v1/group/run") => post_group_run(&body_json, app),
        _ => (404, json!({"error": "not found"})),
    };

    send_response(stream, status, &body);
}

fn send_response(mut stream: TcpStream, status: u16, body: &Value) {
    let body_bytes = serde_json::to_vec(body).unwrap_or_default();
    let status_text = match status {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        500 => "Internal Server Error",
        _ => "Unknown",
    };
    let response = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        status,
        status_text,
        body_bytes.len()
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.write_all(&body_bytes);
    let _ = stream.flush();
}

fn get_status(app: &tauri::AppHandle) -> (u16, Value) {
    // Read the persisted state file directly (store.rs uses free functions, not managed state)
    let status = (|| -> Option<serde_json::Value> {
        let dir = app.path().app_config_dir().ok()?;
        let path = dir.join("vibedeck-state.json");
        let text = std::fs::read_to_string(&path).ok()?;
        serde_json::from_str(&text).ok()
    })();

    (
        200,
        json!({
            "root": status.as_ref().and_then(|v| v.get("lastRoot")).and_then(|v| v.as_str()).unwrap_or(""),
            "persisted": status,
        }),
    )
}

fn post_workspace_open(body: &Option<Value>, app: &tauri::AppHandle) -> (u16, Value) {
    let path = match body {
        Some(obj) => obj.get("path").and_then(|v| v.as_str()),
        None => None,
    };
    let Some(path) = path else {
        return (400, json!({"error": "path is required"}));
    };
    // Emit UI event to open workspace
    let _ = app.emit(
        "agent-ui",
        json!({
            "action": "openWorkspace",
            "path": path
        }),
    );
    (200, json!({"ok": true, "path": path}))
}

fn get_repos(app: &tauri::AppHandle) -> (u16, Value) {
    // Return repos from the current state — the frontend will have them
    // For now, emit a request event
    let _ = app.emit("agent-ui", json!({"action": "getRepos"}));
    (200, json!({"note": "repos available via frontend state"}))
}

fn post_repo_select(body: &Option<Value>, app: &tauri::AppHandle) -> (u16, Value) {
    let (Some(_obj), Some(path_or_name)) = (
        body,
        match body {
            Some(obj) => obj
                .get("path")
                .and_then(|v| v.as_str())
                .or_else(|| obj.get("name").and_then(|v| v.as_str())),
            None => None,
        },
    ) else {
        return (400, json!({"error": "path or name is required"}));
    };
    let _ = app.emit(
        "agent-ui",
        json!({
            "action": "selectRepo",
            "path": path_or_name
        }),
    );
    (200, json!({"ok": true, "path": path_or_name}))
}

fn get_configs(_app: &tauri::AppHandle, body: &Option<Value>) -> (u16, Value) {
    let repo = match body {
        Some(obj) => obj.get("repo").and_then(|v| v.as_str()),
        None => None,
    };
    let Some(repo_path) = repo else {
        return (400, json!({"error": "repo is required"}));
    };
    match super::runs::detect_run_configs(repo_path.to_string()) {
        Ok(configs) => (200, json!({"configs": configs})),
        Err(e) => (500, json!({"error": e})),
    }
}

fn post_run(body: &Option<Value>, app: &tauri::AppHandle) -> (u16, Value) {
    let Some(obj) = body else {
        return (400, json!({"error": "body required: name, command, cwd"}));
    };
    let name = obj
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("agent-run");
    let command = obj.get("command").and_then(|v| v.as_str());
    let cwd = obj.get("cwd").and_then(|v| v.as_str());
    let repo_path = obj
        .get("repoPath")
        .and_then(|v| v.as_str())
        .or_else(|| obj.get("repo").and_then(|v| v.as_str()));

    let (Some(command), Some(cwd)) = (command, cwd) else {
        return (400, json!({"error": "command and cwd are required"}));
    };

    let id = match repo_path {
        Some(rp) => format!("{rp}::{name}"),
        None => format!("{cwd}::{name}"),
    };

    // Emit to UI to start the run (UI handles session creation + backend start)
    let _ = app.emit(
        "agent-ui",
        json!({
            "action": "startRun",
            "id": id,
            "name": name,
            "command": command,
            "cwd": cwd,
            "repoPath": repo_path
        }),
    );

    (200, json!({"ok": true, "id": id, "name": name}))
}

fn post_run_stop(body: &Option<Value>, app: &tauri::AppHandle) -> (u16, Value) {
    let id = match body {
        Some(obj) => obj.get("id").and_then(|v| v.as_str()),
        None => None,
    };
    let Some(id) = id else {
        return (400, json!({"error": "id is required"}));
    };
    let _ = app.emit(
        "agent-ui",
        json!({
            "action": "stopRun",
            "id": id
        }),
    );
    (200, json!({"ok": true, "id": id}))
}

fn get_runs(app: &tauri::AppHandle) -> (u16, Value) {
    // Use the existing list_running tauri command result
    let running = app
        .try_state::<super::runs::ProcessManager>()
        .map(|pm| {
            let guard = pm.running.lock().unwrap();
            guard.keys().cloned().collect::<Vec<_>>()
        })
        .unwrap_or_default();
    (200, json!({"running": running}))
}

fn get_runs_output(query: &str, state: &AgentState) -> (u16, Value) {
    // Parse query string for id and tail
    let mut id: Option<String> = None;
    let mut tail: usize = 100;
    for param in query.split('&') {
        if let Some((k, v)) = param.split_once('=') {
            match k {
                "id" => id = Some(url_decode(v)),
                "tail" => {
                    if let Ok(n) = v.parse() {
                        tail = n;
                    }
                }
                _ => {}
            }
        }
    }
    let Some(id) = id else {
        return (400, json!({"error": "id query param is required"}));
    };
    let lines = state.get_output(&id, tail);
    (200, json!({"id": id, "lines": lines}))
}

/// Minimal URL percent-decoder for ASCII.
fn url_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(s.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(hex) = std::str::from_utf8(&bytes[i + 1..i + 3]) {
                if let Ok(byte) = u8::from_str_radix(hex, 16) {
                    out.push(byte);
                    i += 3;
                    continue;
                }
            }
        }
        if bytes[i] == b'+' {
            out.push(b' ');
        } else {
            out.push(bytes[i]);
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn post_view(body: &Option<Value>, app: &tauri::AppHandle) -> (u16, Value) {
    let Some(obj) = body else {
        return (400, json!({"error": "body required: view"}));
    };
    let view = obj.get("view").and_then(|v| v.as_str());
    let Some(view) = view else {
        return (400, json!({"error": "view is required"}));
    };
    let tab = obj.get("tab").and_then(|v| v.as_str());
    let _ = app.emit(
        "agent-ui",
        json!({
            "action": "setView",
            "view": view,
            "tab": tab
        }),
    );
    (200, json!({"ok": true, "view": view}))
}

fn post_group_run(body: &Option<Value>, app: &tauri::AppHandle) -> (u16, Value) {
    let name = match body {
        Some(obj) => obj.get("name").and_then(|v| v.as_str()),
        None => None,
    };
    let Some(name) = name else {
        return (400, json!({"error": "name is required"}));
    };
    let _ = app.emit(
        "agent-ui",
        json!({
            "action": "runGroup",
            "name": name
        }),
    );
    (200, json!({"ok": true, "group": name}))
}
