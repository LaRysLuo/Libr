mod commands;
mod db;
mod error;
mod models;
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
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .register_uri_scheme_protocol("libr", protocol::respond)
        .setup(|app| {
            if let Some(path) =
                std::env::args()
                    .skip(1)
                    .map(std::path::PathBuf::from)
                    .find(|path| {
                        path.extension()
                            .and_then(|value| value.to_str())
                            .is_some_and(|value| value.eq_ignore_ascii_case("libr"))
                    })
            {
                if let Ok(session) = db::open_library(&path) {
                    *app.state::<AppState>().session.lock() = Some(session);
                }
            }
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
            commands::asset_open_external,
            commands::folder_list,
            commands::folder_create,
            commands::folder_update,
            commands::folder_delete,
            commands::tag_list,
            commands::tag_create,
            commands::tag_delete,
            commands::smart_folder_list,
            commands::smart_folder_upsert,
            commands::smart_folder_delete,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Libr");
}
