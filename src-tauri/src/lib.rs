mod env_files;
mod git;
mod ports;
mod pty;
mod runs;
mod store;

use std::sync::atomic::{AtomicUsize, Ordering};
use tauri::Manager;

static WINDOW_COUNT: AtomicUsize = AtomicUsize::new(1);

#[tauri::command]
fn new_window(app: tauri::AppHandle) -> Result<(), String> {
    let n = WINDOW_COUNT.fetch_add(1, Ordering::SeqCst);
    tauri::WebviewWindowBuilder::new(
        &app,
        format!("main-{n}"),
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("VibeDeck")
    .inner_size(1360.0, 860.0)
    .min_inner_size(960.0, 600.0)
    .build()
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(runs::ProcessManager::default())
        .manage(runs::WatchManager::default())
        .manage(pty::PtyManager::default())
        .invoke_handler(tauri::generate_handler![
            git::scan_repos,
            git::refresh_repo,
            git::repo_status,
            git::list_branches,
            git::checkout_branch,
            git::create_branch,
            git::delete_branch,
            git::stage_file,
            git::unstage_file,
            git::stage_all,
            git::discard_file,
            git::commit,
            git::get_diff,
            git::commit_log,
            git::commit_diff,
            git::rebase_in_progress,
            git::abort_rebase,
            git::git_fetch,
            git::git_pull,
            git::git_push,
            runs::detect_run_configs,
            runs::start_run,
            runs::stop_run,
            runs::list_running,
            runs::watch_run_changes,
            runs::unwatch_run_changes,
            store::load_blob,
            store::save_blob,
            env_files::list_env_files,
            env_files::read_env_file,
            env_files::write_env_file,
            new_window,
            ports::port_lookup,
            ports::kill_pid,
            pty::pty_open,
            pty::pty_input,
            pty::pty_resize,
            pty::pty_close,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // closing VibeDeck must not orphan the dev servers it started
            if let tauri::RunEvent::Exit = event {
                if let Some(pm) = app_handle.try_state::<runs::ProcessManager>() {
                    pm.kill_all();
                }
                if let Some(watchers) = app_handle.try_state::<runs::WatchManager>() {
                    watchers.stop_all();
                }
                if let Some(pty) = app_handle.try_state::<pty::PtyManager>() {
                    pty.kill_all();
                }
            }
        });
}
