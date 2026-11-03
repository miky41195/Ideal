mod claude;
mod claude_mem;
mod fs_cmds;
mod git;
mod hub;
mod plugins;
mod pty;
mod search;
mod settings;

use tauri::{Manager, RunEvent, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(pty::PtyManager::new())
        .manage(git::history::HeatmapCache::default())
        .manage(git::watch::GitWatchers::default())
        .manage(hub::SessionCache::default())
        .invoke_handler(tauri::generate_handler![
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            fs_cmds::list_dir,
            fs_cmds::read_text_file,
            fs_cmds::write_text_file,
            fs_cmds::create_file,
            fs_cmds::create_dir,
            fs_cmds::rename_path,
            fs_cmds::delete_path,
            fs_cmds::gitignore_add,
            git::ops::git_is_ignored,
            git::status::git_status,
            git::ops::git_stage,
            git::ops::git_unstage,
            git::ops::git_discard,
            git::ops::git_commit,
            git::ops::git_branches,
            git::ops::git_switch,
            git::ops::git_create_branch,
            git::ops::git_fetch,
            git::ops::git_pull,
            git::ops::git_push,
            git::diff::git_file_diff,
            git::diff::git_commit_file_diff,
            git::history::git_commit_files,
            git::history::git_heatmap,
            git::history::git_day_commits,
            git::watch::git_watch,
            settings::get_settings,
            settings::settings_path,
            settings::get_recent,
            settings::add_recent,
            settings::open_project_window,
            claude_mem::mem_health,
            claude_mem::mem_observations,
            claude_mem::mem_summaries,
            claude_mem::mem_search,
            claude_mem::mem_start_worker,
            claude_mem::open_in_browser,
            plugins::plugins_status,
            plugins::plugin_enable,
            hub::sessions_list,
            hub::session_read,
            hub::memories_list,
            hub::docs_list,
            search::project_files,
            search::project_search
        ])
        .setup(|app| {
            settings::start_watcher(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::Destroyed = event {
                window.app_handle().state::<pty::PtyManager>().kill_owned_by(window.label());
                window.app_handle().state::<git::watch::GitWatchers>().remove(window.label());
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                app.state::<pty::PtyManager>().kill_all();
            }
        });
}
