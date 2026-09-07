use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

struct Terminal {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

#[derive(Default)]
pub struct PtyManager {
    terminals: Mutex<HashMap<String, Terminal>>,
}

impl PtyManager {
    pub fn kill_all(&self) {
        let mut map = self.terminals.lock().unwrap();
        for (_, t) in map.iter_mut() {
            let _ = t.killer.kill();
        }
        map.clear();
    }
}

#[derive(Serialize, Clone)]
struct PtyOutput {
    id: String,
    data: String,
}

#[derive(Serialize, Clone)]
struct PtyExit {
    id: String,
}

fn default_shell() -> CommandBuilder {
    #[cfg(windows)]
    {
        // powershell is on every Win10/11; friendlier than cmd for dev work
        CommandBuilder::new("powershell.exe")
    }
    #[cfg(not(windows))]
    {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into());
        CommandBuilder::new(shell)
    }
}

#[tauri::command]
pub fn pty_open(
    app: AppHandle,
    state: tauri::State<'_, PtyManager>,
    id: String,
    cwd: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    {
        let map = state.terminals.lock().unwrap();
        if map.contains_key(&id) {
            return Ok(()); // already open (e.g. React strict-mode double mount)
        }
    }

    let pair = native_pty_system()
        .openpty(PtySize {
            rows: rows.max(1),
            cols: cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let mut cmd = default_shell();
    if std::path::Path::new(&cwd).is_dir() {
        cmd.cwd(&cwd);
    }

    let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    let killer = child.clone_killer();
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    state.terminals.lock().unwrap().insert(
        id.clone(),
        Terminal {
            master: pair.master,
            writer,
            killer,
        },
    );

    // pump shell output to the frontend
    let out_app = app.clone();
    let out_id = id.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = out_app.emit(
                        "pty-output",
                        PtyOutput {
                            id: out_id.clone(),
                            data,
                        },
                    );
                }
            }
        }
    });

    // reap the shell and notify when it exits
    let exit_app = app.clone();
    let exit_id = id.clone();
    std::thread::spawn(move || {
        let _ = child.wait();
        let _ = exit_app.emit("pty-exit", PtyExit { id: exit_id });
    });

    Ok(())
}

#[tauri::command]
pub fn pty_input(
    state: tauri::State<'_, PtyManager>,
    id: String,
    data: String,
) -> Result<(), String> {
    let mut map = state.terminals.lock().unwrap();
    let term = map.get_mut(&id).ok_or("terminal not open")?;
    term.writer
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string())?;
    term.writer.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_resize(
    state: tauri::State<'_, PtyManager>,
    id: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    let map = state.terminals.lock().unwrap();
    if let Some(term) = map.get(&id) {
        term.master
            .resize(PtySize {
                rows: rows.max(1),
                cols: cols.max(1),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn pty_close(state: tauri::State<'_, PtyManager>, id: String) -> Result<(), String> {
    if let Some(mut term) = state.terminals.lock().unwrap().remove(&id) {
        let _ = term.killer.kill();
    }
    Ok(())
}
