mod claude;
mod fs_cmds;
mod pty;
mod settings;

use tauri::{Manager, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(pty::PtyManager::new())
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
            settings::get_settings,
            settings::get_recent,
            settings::add_recent,
            settings::open_project_window
        ])
        .setup(|app| {
            settings::start_watcher(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::Destroyed = event {
                window.app_handle().state::<pty::PtyManager>().kill_all();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
