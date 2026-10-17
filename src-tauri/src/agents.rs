use serde::Serialize;
use std::path::{Path, PathBuf};

/// Coding-agent CLIs Vide knows how to launch in a repo terminal.
/// `bin` is what is looked up on PATH and typed into the shell.
const KNOWN_AGENTS: &[(&str, &str, &str)] = &[
    ("claude", "Claude Code", "claude"),
    ("codex", "Codex CLI", "codex"),
    ("gemini", "Gemini CLI", "gemini"),
    ("cursor-agent", "Cursor Agent", "cursor-agent"),
    ("copilot", "GitHub Copilot CLI", "copilot"),
    ("aider", "Aider", "aider"),
    ("opencode", "opencode", "opencode"),
    ("amp", "Amp", "amp"),
    ("goose", "Goose", "goose"),
    ("qwen", "Qwen Code", "qwen"),
];

#[derive(Serialize, Clone)]
pub struct AgentCli {
    pub id: String,
    pub name: String,
    pub command: String,
    pub path: String,
}

fn exe_candidates(dir: &Path, bin: &str) -> Vec<PathBuf> {
    #[cfg(windows)]
    {
        let exts = std::env::var("PATHEXT").unwrap_or_else(|_| ".EXE;.CMD;.BAT;.PS1".into());
        let mut out: Vec<PathBuf> = exts
            .split(';')
            .filter(|e| !e.is_empty())
            .map(|e| dir.join(format!("{bin}{}", e.to_lowercase())))
            .collect();
        // npm global installs drop a .ps1 shim that is not always in PATHEXT
        out.push(dir.join(format!("{bin}.ps1")));
        out
    }
    #[cfg(not(windows))]
    {
        vec![dir.join(bin)]
    }
}

/// Find `bin` on PATH, returning the first matching file.
pub fn which(bin: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .flat_map(|dir| exe_candidates(&dir, bin))
        .find(|p| p.is_file())
}

/// Coding-agent CLIs installed on this machine, in display order.
#[tauri::command]
pub fn detect_agent_clis() -> Vec<AgentCli> {
    KNOWN_AGENTS
        .iter()
        .filter_map(|(id, name, bin)| {
            which(bin).map(|p| AgentCli {
                id: id.to_string(),
                name: name.to_string(),
                command: bin.to_string(),
                path: p.to_string_lossy().into_owned(),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_agent_ids_are_unique() {
        let mut ids: Vec<_> = KNOWN_AGENTS.iter().map(|a| a.0).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), KNOWN_AGENTS.len());
    }

    #[test]
    fn which_misses_nonexistent_binary() {
        assert!(which("definitely-not-a-real-agent-cli-xyz").is_none());
    }
}
