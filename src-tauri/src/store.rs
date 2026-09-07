use std::fs;
use tauri::{AppHandle, Manager};

fn state_file(app: &AppHandle, key: &str) -> Result<std::path::PathBuf, String> {
    if !key
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("invalid state key".into());
    }
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(format!("{key}.json")))
}

#[tauri::command]
pub fn load_blob(app: AppHandle, key: String) -> Result<Option<String>, String> {
    let path = state_file(&app, &key)?;
    match fs::read_to_string(&path) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn save_blob(app: AppHandle, key: String, value: String) -> Result<(), String> {
    let path = state_file(&app, &key)?;
    // write-then-rename: never leaves a half-written state file, and failures
    // carry the full path so they're diagnosable from the UI error bar
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, &value).map_err(|e| format!("writing {}: {e}", tmp.display()))?;
    fs::rename(&tmp, &path).map_err(|e| format!("replacing {}: {e}", path.display()))?;
    Ok(())
}
