use serde::Serialize;
use std::collections::BTreeMap;
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Serialize)]
pub struct PortProcess {
    pub pid: u32,
    pub name: String,
    pub addresses: String,
    pub state: String,
}

fn run(cmd: &str, args: &[&str]) -> Result<String, String> {
    let mut c = Command::new(cmd);
    c.args(args);
    #[cfg(windows)]
    c.creation_flags(CREATE_NO_WINDOW);
    let out = c
        .output()
        .map_err(|e| format!("failed to run {cmd}: {e}"))?;
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

fn process_name(pid: u32) -> String {
    let filter = format!("PID eq {pid}");
    let out = run("tasklist", &["/FO", "CSV", "/NH", "/FI", &filter]).unwrap_or_default();
    out.lines()
        .next()
        .and_then(|line| line.split(',').next())
        .map(|s| s.trim_matches('"').to_string())
        .unwrap_or_else(|| "unknown".into())
}

#[tauri::command]
pub fn port_lookup(port: u16) -> Result<Vec<PortProcess>, String> {
    let out = run("netstat", &["-ano"])?;
    let suffix = format!(":{port}");
    // pid -> (addresses, state)
    let mut by_pid: BTreeMap<u32, (Vec<String>, String)> = BTreeMap::new();

    for line in out.lines() {
        let cols: Vec<&str> = line.split_whitespace().collect();
        // TCP: proto local foreign state pid — UDP: proto local foreign pid
        let (local, state, pid_str) = match cols.as_slice() {
            [proto, local, _foreign, state, pid] if proto.eq_ignore_ascii_case("tcp") => {
                (*local, *state, *pid)
            }
            [proto, local, _foreign, pid] if proto.eq_ignore_ascii_case("udp") => {
                (*local, "UDP", *pid)
            }
            _ => continue,
        };
        if !local.ends_with(&suffix) {
            continue;
        }
        let Ok(pid) = pid_str.parse::<u32>() else {
            continue;
        };
        if pid == 0 {
            continue;
        }
        let entry = by_pid
            .entry(pid)
            .or_insert_with(|| (Vec::new(), state.to_string()));
        if !entry.0.contains(&local.to_string()) {
            entry.0.push(local.to_string());
        }
    }

    Ok(by_pid
        .into_iter()
        .map(|(pid, (addresses, state))| PortProcess {
            name: process_name(pid),
            pid,
            addresses: addresses.join(", "),
            state,
        })
        .collect())
}

#[tauri::command]
pub fn kill_pid(pid: u32) -> Result<(), String> {
    if pid <= 4 {
        return Err("refusing to kill a system process".into());
    }
    let mut c = Command::new("taskkill");
    c.args(["/PID", &pid.to_string(), "/T", "/F"]);
    #[cfg(windows)]
    c.creation_flags(CREATE_NO_WINDOW);
    let out = c.output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}
