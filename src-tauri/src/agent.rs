use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
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

/// First set environment variable among `names` (new VIDE_* names win over
/// the legacy VIBEDECK_* ones).
fn env_any(names: &[&str]) -> Option<String> {
    names
        .iter()
        .find_map(|n| std::env::var(n).ok().filter(|v| !v.is_empty()))
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
        let cfg = AgentConfig {
            port: env_any(&["VIDE_AGENT_PORT", "VIBEDECK_AGENT_PORT"])
                .and_then(|s| s.parse().ok())
                .unwrap_or(DEFAULT_PORT),
            token: env_any(&["VIDE_AGENT_TOKEN", "VIBEDECK_AGENT_TOKEN"])
                .unwrap_or_else(|| random_token(TOKEN_LEN)),
        };
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
    let Some(body) = read_body(&mut reader, content_length) else {
        return;
    };
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
        ("GET", "/health") => (200, json!({"status": "ok", "app": "vide"})),
        ("GET", "/v1") => (200, describe()),
        ("GET", "/v1/status") => get_status(app),
        ("POST", "/v1/workspace/open") => post_workspace_open(&body_json, app),
        ("GET", "/v1/repos") => get_repos(app),
        ("POST", "/v1/repo/select") => post_repo_select(&body_json, app),
        ("GET", "/v1/configs") => get_configs(query, &body_json),
        ("POST", "/v1/run") => post_run(&body_json, app),
        ("POST", "/v1/run/stop") => post_run_stop(&body_json, app),
        ("GET", "/v1/runs") => get_runs(app),
        ("GET", "/v1/runs/output") => get_runs_output(query, state),
        ("POST", "/v1/view") => post_view(&body_json, app),
        ("POST", "/v1/group/run") => post_group_run(&body_json, app),
        ("GET", "/v1/git/status") => get_git_status(query),
        ("GET", "/v1/git/diff") => get_git_diff(query),
        ("GET", "/v1/agents") => (200, json!({"agents": super::agents::detect_agent_clis()})),
        ("POST", "/v1/terminal/open") => post_terminal_open(&body_json, app),
        ("POST", "/v1/notify") => post_notify(&body_json, app),
        ("POST", "/v1/file/open") => post_file_open(&body_json, app),
        _ => (404, json!({"error": "not found"})),
    };

    send_response(stream, status, &body);
}

/// Largest request body the API accepts; every route takes a small JSON object.
const MAX_BODY: usize = 1 << 20;

/// Read exactly `len` body bytes. `read_to_end` appends, so the buffer must
/// start empty rather than pre-sized with zeros.
fn read_body(reader: &mut impl std::io::Read, len: usize) -> Option<Vec<u8>> {
    if len > MAX_BODY {
        return None;
    }
    let mut body = Vec::with_capacity(len);
    reader.take(len as u64).read_to_end(&mut body).ok()?;
    Some(body)
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
    let (_, status) = get_status(app);
    let root = status.get("root").and_then(|v| v.as_str()).unwrap_or("");
    if root.is_empty() {
        return (200, json!({"root": null, "repos": []}));
    }
    match super::git::scan_repos(root.to_string()) {
        Ok(repos) => (200, json!({"root": root, "repos": repos})),
        Err(e) => (500, json!({"error": e})),
    }
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

fn get_configs(query: &str, body: &Option<Value>) -> (u16, Value) {
    // GET clients send `?repo=`; older callers put it in a JSON body
    let repo = query_param(query, "repo").or_else(|| {
        body.as_ref()
            .and_then(|obj| obj.get("repo"))
            .and_then(|v| v.as_str())
            .map(str::to_string)
    });
    let Some(repo_path) = repo else {
        return (400, json!({"error": "repo is required"}));
    };
    match super::runs::detect_run_configs(repo_path) {
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
    let id = query_param(query, "id");
    let tail: usize = query_param(query, "tail")
        .and_then(|v| v.parse().ok())
        .unwrap_or(100);
    let Some(id) = id else {
        return (400, json!({"error": "id query param is required"}));
    };
    let lines = state.get_output(&id, tail);
    (200, json!({"id": id, "lines": lines}))
}

/// Decoded value of `key` in a `a=1&b=2` query string.
fn query_param(query: &str, key: &str) -> Option<String> {
    query.split('&').find_map(|param| {
        let (k, v) = param.split_once('=')?;
        (k == key).then(|| url_decode(v))
    })
}

fn get_git_status(query: &str) -> (u16, Value) {
    let Some(repo) = query_param(query, "repo") else {
        return (400, json!({"error": "repo query param is required"}));
    };
    match super::git::repo_status(repo) {
        Ok(status) => (200, json!(status)),
        Err(e) => (500, json!({"error": e})),
    }
}

fn get_git_diff(query: &str) -> (u16, Value) {
    let Some(repo) = query_param(query, "repo") else {
        return (400, json!({"error": "repo query param is required"}));
    };
    let file = query_param(query, "file");
    let staged = query_param(query, "staged").is_some_and(|v| v == "1" || v == "true");
    match super::git::get_diff(repo, file, staged, false) {
        Ok(diff) => (200, json!({"diff": diff})),
        Err(e) => (500, json!({"error": e})),
    }
}

fn post_terminal_open(body: &Option<Value>, app: &tauri::AppHandle) -> (u16, Value) {
    let Some(obj) = body else {
        return (400, json!({"error": "body required: cwd"}));
    };
    let str_field = |k: &str| obj.get(k).and_then(|v| v.as_str()).map(str::to_string);
    let Some(cwd) = str_field("cwd") else {
        return (400, json!({"error": "cwd is required"}));
    };
    // `agent` resolves a known coding-agent CLI id (claude, codex, ...) to its command
    let agent = str_field("agent");
    let command = match (&agent, str_field("command")) {
        (_, Some(c)) => Some(c),
        (Some(id), None) => match super::agents::detect_agent_clis()
            .into_iter()
            .find(|a| &a.id == id)
        {
            Some(a) => Some(a.command),
            None => {
                return (
                    404,
                    json!({"error": format!("agent CLI '{id}' not found on PATH")}),
                )
            }
        },
        (None, None) => None,
    };
    let title = str_field("title").or_else(|| agent.clone());
    let _ = app.emit(
        "agent-ui",
        json!({
            "action": "openTerminal",
            "cwd": cwd,
            "command": command,
            "title": title
        }),
    );
    (200, json!({"ok": true, "cwd": cwd, "command": command}))
}

fn post_notify(body: &Option<Value>, app: &tauri::AppHandle) -> (u16, Value) {
    let Some(obj) = body else {
        return (400, json!({"error": "body required: message"}));
    };
    let field = |k: &str| obj.get(k).and_then(|v| v.as_str());
    let Some(message) = field("message") else {
        return (400, json!({"error": "message is required"}));
    };
    let level = match field("level") {
        Some(l @ ("info" | "success" | "warning" | "error")) => l,
        _ => "info",
    };
    let _ = app.emit(
        "agent-ui",
        json!({
            "action": "notify",
            "title": field("title").unwrap_or("Agent"),
            "message": message,
            "level": level,
            "repo": field("repo")
        }),
    );
    (200, json!({"ok": true}))
}

fn post_file_open(body: &Option<Value>, app: &tauri::AppHandle) -> (u16, Value) {
    let path = body
        .as_ref()
        .and_then(|obj| obj.get("path"))
        .and_then(|v| v.as_str());
    let Some(path) = path else {
        return (400, json!({"error": "path is required"}));
    };
    if !std::path::Path::new(path).is_file() {
        return (404, json!({"error": format!("{path} is not a file")}));
    }
    let line = body
        .as_ref()
        .and_then(|obj| obj.get("line"))
        .and_then(|v| v.as_u64());
    let _ = app.emit(
        "agent-ui",
        json!({ "action": "openFile", "path": path, "line": line }),
    );
    (200, json!({"ok": true, "path": path, "line": line}))
}

/// Machine-readable route list so agents can discover the API.
fn describe() -> Value {
    json!({
        "app": "vide",
        "auth": "Authorization: Bearer <token from agent.json>",
        "routes": [
            {"method": "GET", "path": "/health", "auth": false},
            {"method": "GET", "path": "/v1/status"},
            {"method": "GET", "path": "/v1/repos"},
            {"method": "POST", "path": "/v1/workspace/open", "body": {"path": "string"}},
            {"method": "POST", "path": "/v1/repo/select", "body": {"path|name": "string"}},
            {"method": "GET", "path": "/v1/configs", "query": {"repo": "path"}},
            {"method": "POST", "path": "/v1/run", "body": {"name": "string", "command": "string", "cwd": "path", "repoPath": "path?"}},
            {"method": "POST", "path": "/v1/run/stop", "body": {"id": "string"}},
            {"method": "GET", "path": "/v1/runs"},
            {"method": "GET", "path": "/v1/runs/output", "query": {"id": "string", "tail": "number?"}},
            {"method": "POST", "path": "/v1/view", "body": {"view": "repo|favorites|sync|code", "tab": "changes|branches|history|run|env?"}},
            {"method": "POST", "path": "/v1/file/open", "body": {"path": "absolute file path", "line": "number?"}},
            {"method": "POST", "path": "/v1/group/run", "body": {"name": "string"}},
            {"method": "GET", "path": "/v1/git/status", "query": {"repo": "path"}},
            {"method": "GET", "path": "/v1/git/diff", "query": {"repo": "path", "file": "string?", "staged": "bool?"}},
            {"method": "GET", "path": "/v1/agents"},
            {"method": "POST", "path": "/v1/terminal/open", "body": {"cwd": "path", "agent": "claude|codex|...?", "command": "string?", "title": "string?"}},
            {"method": "POST", "path": "/v1/notify", "body": {"message": "string", "title": "string?", "level": "info|success|warning|error?", "repo": "path?"}}
        ]
    })
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_body_returns_only_the_body_bytes() {
        let mut input: &[u8] = b"{\"path\":\"x\"}trailing";
        let body = read_body(&mut input, 12).unwrap();
        assert_eq!(body, b"{\"path\":\"x\"}");
        let parsed: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(parsed["path"], "x");
    }

    #[test]
    fn read_body_rejects_oversized_bodies() {
        let mut input: &[u8] = b"";
        assert!(read_body(&mut input, MAX_BODY + 1).is_none());
    }

    #[test]
    fn query_param_decodes_values() {
        let q = "repo=C%3A%5Cprojects%5Capp&tail=50";
        assert_eq!(query_param(q, "repo").as_deref(), Some("C:\\projects\\app"));
        assert_eq!(query_param(q, "tail").as_deref(), Some("50"));
        assert_eq!(query_param(q, "missing"), None);
    }

    #[test]
    fn describe_lists_every_routed_path() {
        let paths: Vec<String> = describe()["routes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| r["path"].as_str().unwrap().to_string())
            .collect();
        for p in [
            "/v1/notify",
            "/v1/terminal/open",
            "/v1/git/diff",
            "/v1/agents",
            "/v1/file/open",
        ] {
            assert!(paths.iter().any(|x| x == p), "{p} missing from describe()");
        }
    }
}
