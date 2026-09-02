mod commands;
mod db;
mod error;
mod lan_share;
mod models;
mod preferences;
mod protocol;
mod state;

use state::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = AppState::default();
    tauri::Builder::default()
        .manage(state)
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_drag::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .register_uri_scheme_protocol("libr", protocol::respond)
        .setup(|app| {
            let command_line_library =
                std::env::args()
                    .skip(1)
                    .map(std::path::PathBuf::from)
                    .find(|path| {
                        path.extension()
                            .and_then(|value| value.to_str())
                            .is_some_and(|value| value.eq_ignore_ascii_case("libr"))
                    });
            let config_dir = app.path().app_config_dir()?;
            let startup_library = command_line_library
                .as_ref()
                .cloned()
                .or_else(|| preferences::last_library_path(&config_dir));

            if let Some(path) = startup_library {
                match db::open_library(&path) {
                    Ok(session) => {
                        let opened_path = session.path.clone();
                        *app.state::<AppState>().session.lock() = Some(session);
                        if let Err(error) = preferences::remember_library(&config_dir, &opened_path)
                        {
                            eprintln!("无法记住最近打开的资源库：{error}");
                        }
                    }
                    Err(error) => {
                        eprintln!("无法恢复上次打开的资源库：{error}");
                        if command_line_library.is_none() {
                            let _ = preferences::forget_library(&config_dir);
                        }
                    }
                }
            }
            lan_share::start_discovery(
                app.handle().clone(),
                app.state::<AppState>().inner().clone(),
            );
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::library_create,
            commands::library_open,
            commands::library_close,
            commands::library_inspect,
            commands::library_save_copy,
            commands::library_compact,
            commands::library_integrity,
            commands::asset_list,
            commands::asset_import,
            commands::asset_cancel_import,
            commands::asset_update,
            commands::asset_trash,
            commands::asset_restore,
            commands::asset_purge,
            commands::asset_export,
            commands::asset_prepare_drag,
            commands::asset_open_external,
            commands::folder_list,
            commands::folder_assign_assets,
            commands::folder_create,
            commands::folder_update,
            commands::folder_delete,
            commands::folder_set_password,
            commands::folder_unlock,
            commands::folder_lock,
            commands::folder_clear_password,
            commands::tag_list,
            commands::tag_create,
            commands::tag_delete,
            commands::smart_folder_list,
            commands::smart_folder_upsert,
            commands::smart_folder_delete,
            commands::lan_share_start,
            commands::lan_share_stop,
            commands::lan_share_status,
            commands::lan_share_discovered,
            commands::lan_share_open,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Libr");
}
