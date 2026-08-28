use std::{
    fs,
    path::{Path, PathBuf},
};

use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;
use walkdir::WalkDir;

use crate::{
    db,
    error::{LibrError, LibrResult},
    models::{
        Asset, AssetPatch, FailedImport, Folder, ImportResult, JobProgress, LibraryInfo,
        SearchQuery, SmartFolder, Tag,
    },
    state::AppState,
};

fn emit_progress(app: &AppHandle, progress: JobProgress) {
    let _ = app.emit("job-progress", progress);
}

fn collect_files(paths: &[String]) -> Vec<PathBuf> {
    let mut files = Vec::new();
    for raw_path in paths {
        let path = PathBuf::from(raw_path);
        if path.is_dir() {
            files.extend(
                WalkDir::new(path)
                    .follow_links(false)
                    .into_iter()
                    .filter_map(Result::ok)
                    .filter(|entry| entry.file_type().is_file())
                    .map(|entry| entry.into_path()),
            );
        } else if path.is_file() {
            files.push(path);
        }
    }
    files.sort();
    files.dedup();
    files
}

fn authorize_asset(state: &AppState, asset: &mut Asset) {
    asset.stream_token = Some(state.stream_tokens.lock().token_for(&asset.id));
}

#[tauri::command]
pub fn library_create(
    state: State<'_, AppState>,
    path: String,
    name: String,
) -> LibrResult<LibraryInfo> {
    let session = db::create_library(Path::new(&path), &name)?;
    let info = db::library_info(&session)?;
    *state.session.lock() = Some(session);
    state.stream_tokens.lock().clear();
    Ok(info)
}

#[tauri::command]
pub fn library_open(state: State<'_, AppState>, path: String) -> LibrResult<LibraryInfo> {
    let session = db::open_library(Path::new(&path))?;
    let info = db::library_info(&session)?;
    *state.session.lock() = Some(session);
    state.stream_tokens.lock().clear();
    Ok(info)
}

#[tauri::command]
pub fn library_close(state: State<'_, AppState>) {
    *state.session.lock() = None;
    state.stream_tokens.lock().clear();
}

#[tauri::command]
pub fn library_inspect(state: State<'_, AppState>) -> LibrResult<Option<LibraryInfo>> {
    let guard = state.session.lock();
    guard.as_ref().map(db::library_info).transpose()
}

#[tauri::command]
pub fn library_save_copy(state: State<'_, AppState>, path: String) -> LibrResult<()> {
    let guard = state.session.lock();
    let session = guard.as_ref().ok_or(LibrError::NoLibrary)?;
    db::backup_library(session, Path::new(&path))
}

#[tauri::command]
pub fn library_integrity(state: State<'_, AppState>) -> LibrResult<Vec<String>> {
    let guard = state.session.lock();
    db::integrity_check(guard.as_ref().ok_or(LibrError::NoLibrary)?)
}

#[tauri::command]
pub fn library_compact(state: State<'_, AppState>) -> LibrResult<LibraryInfo> {
    let mut guard = state.session.lock();
    let session = guard.take().ok_or(LibrError::NoLibrary)?;
    if session.read_only {
        *guard = Some(session);
        return Err(LibrError::ReadOnly);
    }
    let original = session.path.clone();
    let compacting = original.with_extension("libr.compacting");
    let previous = original.with_extension("libr.previous");
    if compacting.exists() {
        fs::remove_file(&compacting)?;
    }
    if previous.exists() {
        fs::remove_file(&previous)?;
    }

    if let Err(error) = db::backup_library(&session, &compacting) {
        *guard = Some(session);
        return Err(error);
    }
    drop(session);

    let compact_result = (|| -> LibrResult<()> {
        let compact_conn = rusqlite::Connection::open(&compacting)?;
        compact_conn.execute_batch("VACUUM; PRAGMA optimize;")?;
        drop(compact_conn);
        fs::rename(&original, &previous)?;
        if let Err(error) = fs::rename(&compacting, &original) {
            let _ = fs::rename(&previous, &original);
            return Err(error.into());
        }
        fs::remove_file(&previous)?;
        Ok(())
    })();

    let reopened = db::open_library(&original)?;
    let info = db::library_info(&reopened)?;
    *guard = Some(reopened);
    compact_result?;
    Ok(info)
}

#[tauri::command]
pub fn asset_list(state: State<'_, AppState>, query: SearchQuery) -> LibrResult<Vec<Asset>> {
    let guard = state.session.lock();
    let mut assets = db::list_assets(guard.as_ref().ok_or(LibrError::NoLibrary)?, &query)?;
    drop(guard);
    for asset in &mut assets {
        authorize_asset(state.inner(), asset);
    }
    Ok(assets)
}

#[tauri::command]
pub async fn asset_import(
    app: AppHandle,
    state: State<'_, AppState>,
    paths: Vec<String>,
    folder_id: Option<String>,
) -> LibrResult<ImportResult> {
    let job_id = Uuid::new_v4().to_string();
    let files = collect_files(&paths);
    let total = files.len();
    let shared_state = state.inner().clone();
    let job_id_for_worker = job_id.clone();
    let app_for_worker = app.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let mut imported = Vec::new();
        let mut duplicates = 0usize;
        let mut failed = Vec::new();
        for (index, path) in files.iter().enumerate() {
            if shared_state
                .cancelled_jobs
                .lock()
                .contains(&job_id_for_worker)
            {
                emit_progress(
                    &app_for_worker,
                    JobProgress {
                        job_id: job_id_for_worker.clone(),
                        kind: "import".into(),
                        completed: index,
                        total,
                        current_item: None,
                        phase: "cancelled".into(),
                        message: None,
                    },
                );
                return Err(LibrError::Cancelled);
            }
            emit_progress(
                &app_for_worker,
                JobProgress {
                    job_id: job_id_for_worker.clone(),
                    kind: "import".into(),
                    completed: index,
                    total,
                    current_item: Some(path.to_string_lossy().to_string()),
                    phase: "running".into(),
                    message: None,
                },
            );
            let result = {
                let mut guard = shared_state.session.lock();
                let session = guard.as_mut().ok_or(LibrError::NoLibrary)?;
                db::import_file(session, path, folder_id.as_deref())
            };
            match result {
                Ok(result) => {
                    if result.duplicate {
                        duplicates += 1;
                    } else {
                        imported.push(result.asset);
                    }
                }
                Err(error) => failed.push(FailedImport {
                    path: path.to_string_lossy().to_string(),
                    message: error.to_string(),
                }),
            }
        }
        emit_progress(
            &app_for_worker,
            JobProgress {
                job_id: job_id_for_worker.clone(),
                kind: "import".into(),
                completed: total,
                total,
                current_item: None,
                phase: "complete".into(),
                message: None,
            },
        );
        let _ = app_for_worker.emit("library-changed", "assets");
        Ok(ImportResult {
            job_id: job_id_for_worker,
            imported,
            duplicates,
            failed,
        })
    })
    .await
    .map_err(|error| LibrError::Other(error.to_string()))?
}

#[tauri::command]
pub fn asset_cancel_import(state: State<'_, AppState>, job_id: String) {
    state.cancelled_jobs.lock().insert(job_id);
}

#[tauri::command]
pub fn asset_update(
    state: State<'_, AppState>,
    asset_id: String,
    patch: AssetPatch,
) -> LibrResult<Asset> {
    let mut guard = state.session.lock();
    let mut asset = db::update_asset(
        guard.as_mut().ok_or(LibrError::NoLibrary)?,
        &asset_id,
        &patch,
    )?;
    drop(guard);
    authorize_asset(state.inner(), &mut asset);
    Ok(asset)
}

#[tauri::command]
pub fn asset_trash(state: State<'_, AppState>, asset_ids: Vec<String>) -> LibrResult<()> {
    let mut guard = state.session.lock();
    db::set_assets_deleted(
        guard.as_mut().ok_or(LibrError::NoLibrary)?,
        &asset_ids,
        true,
    )
}

#[tauri::command]
pub fn asset_restore(state: State<'_, AppState>, asset_ids: Vec<String>) -> LibrResult<()> {
    let mut guard = state.session.lock();
    db::set_assets_deleted(
        guard.as_mut().ok_or(LibrError::NoLibrary)?,
        &asset_ids,
        false,
    )
}

#[tauri::command]
pub fn asset_purge(state: State<'_, AppState>, asset_ids: Vec<String>) -> LibrResult<()> {
    let mut guard = state.session.lock();
    db::purge_assets(guard.as_mut().ok_or(LibrError::NoLibrary)?, &asset_ids)
}

#[tauri::command]
pub fn asset_export(
    state: State<'_, AppState>,
    asset_ids: Vec<String>,
    destination: String,
) -> LibrResult<()> {
    let guard = state.session.lock();
    db::export_assets(
        guard.as_ref().ok_or(LibrError::NoLibrary)?,
        &asset_ids,
        Path::new(&destination),
    )
}

#[tauri::command]
pub fn asset_open_external(
    app: AppHandle,
    state: State<'_, AppState>,
    asset_id: String,
) -> LibrResult<()> {
    let cache_root = app
        .path()
        .app_cache_dir()
        .map_err(|error| LibrError::Other(error.to_string()))?
        .join("external")
        .join(&asset_id);
    fs::create_dir_all(&cache_root)?;
    let guard = state.session.lock();
    let session = guard.as_ref().ok_or(LibrError::NoLibrary)?;
    let asset = db::get_asset(session, &asset_id)?;
    let destination = cache_root.join(asset.display_name.replace(['/', '\\'], "_"));
    let mut target = fs::File::create(&destination)?;
    db::stream_asset_to_writer(session, &asset_id, &mut target)?;
    let mut permissions = fs::metadata(&destination)?.permissions();
    permissions.set_readonly(true);
    fs::set_permissions(&destination, permissions)?;
    opener::open(destination).map_err(|error| LibrError::Other(error.to_string()))?;
    Ok(())
}

#[tauri::command]
pub fn folder_list(state: State<'_, AppState>) -> LibrResult<Vec<Folder>> {
    let guard = state.session.lock();
    db::list_folders(guard.as_ref().ok_or(LibrError::NoLibrary)?)
}

#[tauri::command]
pub fn folder_create(
    state: State<'_, AppState>,
    name: String,
    parent_id: Option<String>,
) -> LibrResult<Folder> {
    let mut guard = state.session.lock();
    db::create_folder(
        guard.as_mut().ok_or(LibrError::NoLibrary)?,
        &name,
        parent_id.as_deref(),
    )
}

#[tauri::command]
pub fn folder_update(
    state: State<'_, AppState>,
    id: String,
    name: String,
    parent_id: Option<String>,
) -> LibrResult<Folder> {
    let mut guard = state.session.lock();
    db::update_folder(
        guard.as_mut().ok_or(LibrError::NoLibrary)?,
        &id,
        &name,
        parent_id.as_deref(),
    )
}

#[tauri::command]
pub fn folder_delete(state: State<'_, AppState>, id: String) -> LibrResult<()> {
    let mut guard = state.session.lock();
    db::delete_folder(guard.as_mut().ok_or(LibrError::NoLibrary)?, &id)
}

#[tauri::command]
pub fn tag_list(state: State<'_, AppState>) -> LibrResult<Vec<Tag>> {
    let guard = state.session.lock();
    db::list_tags(guard.as_ref().ok_or(LibrError::NoLibrary)?)
}

#[tauri::command]
pub fn tag_create(
    state: State<'_, AppState>,
    name: String,
    color: Option<String>,
) -> LibrResult<Tag> {
    let mut guard = state.session.lock();
    db::create_tag(
        guard.as_mut().ok_or(LibrError::NoLibrary)?,
        &name,
        color.as_deref(),
    )
}

#[tauri::command]
pub fn tag_delete(state: State<'_, AppState>, id: String) -> LibrResult<()> {
    let mut guard = state.session.lock();
    db::delete_tag(guard.as_mut().ok_or(LibrError::NoLibrary)?, &id)
}

#[tauri::command]
pub fn smart_folder_list(state: State<'_, AppState>) -> LibrResult<Vec<SmartFolder>> {
    let guard = state.session.lock();
    db::list_smart_folders(guard.as_ref().ok_or(LibrError::NoLibrary)?)
}

#[tauri::command]
pub fn smart_folder_upsert(
    state: State<'_, AppState>,
    id: Option<String>,
    name: String,
    query: serde_json::Value,
) -> LibrResult<SmartFolder> {
    let mut guard = state.session.lock();
    db::upsert_smart_folder(
        guard.as_mut().ok_or(LibrError::NoLibrary)?,
        id.as_deref(),
        &name,
        &query,
    )
}

#[tauri::command]
pub fn smart_folder_delete(state: State<'_, AppState>, id: String) -> LibrResult<()> {
    let mut guard = state.session.lock();
    db::delete_smart_folder(guard.as_mut().ok_or(LibrError::NoLibrary)?, &id)
}
