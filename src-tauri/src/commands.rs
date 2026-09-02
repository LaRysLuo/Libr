use std::{
    collections::HashSet,
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
        Asset, AssetPatch, DiscoveredLanShare, FailedImport, Folder, ImportResult, JobProgress,
        LanShareInfo, LibraryInfo, SearchQuery, SmartFolder, Tag,
    },
    preferences,
    state::AppState,
};

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedAssetDrag {
    paths: Vec<String>,
    icon_path: String,
}

fn remember_library(app: &AppHandle, path: &Path) {
    let result = app
        .path()
        .app_config_dir()
        .map_err(|error| LibrError::Other(error.to_string()))
        .and_then(|config_dir| preferences::remember_library(&config_dir, path));
    if let Err(error) = result {
        eprintln!("无法记住最近打开的资源库：{error}");
    }
}

fn emit_progress(app: &AppHandle, progress: JobProgress) {
    let _ = app.emit("job-progress", progress);
}

fn library_storage_paths(library_path: &Path) -> HashSet<PathBuf> {
    let mut paths = HashSet::from([library_path.to_path_buf()]);
    let library = library_path.to_string_lossy();
    for suffix in ["-journal", "-wal", "-shm"] {
        paths.insert(PathBuf::from(format!("{library}{suffix}")));
    }
    paths
}

fn collect_files(paths: &[String], library_path: &Path) -> Vec<PathBuf> {
    let excluded = library_storage_paths(library_path);
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
    files.retain(|path| !excluded.contains(path));
    files.sort();
    files.dedup();
    files
}

fn is_same_file(left: &Path, right: &Path) -> LibrResult<bool> {
    Ok(fs::canonicalize(left)? == fs::canonicalize(right)?)
}

fn delete_import_source(path: &Path, library_path: &Path) -> LibrResult<()> {
    if is_same_file(path, library_path)? {
        return Err(LibrError::Other("不能删除当前正在使用的资源库文件".into()));
    }
    fs::remove_file(path)?;
    Ok(())
}

fn authorize_asset(state: &AppState, asset: &mut Asset) {
    asset.stream_token = Some(state.stream_tokens.lock().token_for(&asset.id));
}

fn blocked_folder_ids(
    state: &AppState,
    session: &db::LibrarySession,
) -> LibrResult<HashSet<String>> {
    let unlocked = state.unlocked_folders.lock().clone();
    Ok(db::folder_lock_owners(session, &unlocked)?
        .into_keys()
        .collect())
}

fn ensure_folder_accessible(blocked: &HashSet<String>, folder_id: &str) -> LibrResult<()> {
    if blocked.contains(folder_id) {
        Err(LibrError::Other("文件夹已锁定，请先输入密码解锁".into()))
    } else {
        Ok(())
    }
}

#[tauri::command]
pub fn library_create(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    name: String,
) -> LibrResult<LibraryInfo> {
    state.stop_lan_share();
    let session = db::create_library(Path::new(&path), &name)?;
    let info = db::library_info(&session)?;
    let library_path = session.path.clone();
    *state.session.lock() = Some(session);
    state.stream_tokens.lock().clear();
    state.unlocked_folders.lock().clear();
    remember_library(&app, &library_path);
    Ok(info)
}

#[tauri::command]
pub fn library_open(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> LibrResult<LibraryInfo> {
    state.stop_lan_share();
    let session = db::open_library(Path::new(&path))?;
    let info = db::library_info(&session)?;
    let library_path = session.path.clone();
    *state.session.lock() = Some(session);
    state.stream_tokens.lock().clear();
    state.unlocked_folders.lock().clear();
    remember_library(&app, &library_path);
    Ok(info)
}

#[tauri::command]
pub fn library_close(state: State<'_, AppState>) {
    state.stop_lan_share();
    *state.session.lock() = None;
    state.stream_tokens.lock().clear();
    state.unlocked_folders.lock().clear();
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
    state.stop_lan_share();
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
    state.unlocked_folders.lock().clear();
    state.stream_tokens.lock().clear();
    Ok(info)
}

#[tauri::command]
pub fn lan_share_start(
    app: AppHandle,
    state: State<'_, AppState>,
    folder_id: String,
    allow_editing: bool,
) -> LibrResult<LanShareInfo> {
    crate::lan_share::start(app, state.inner().clone(), folder_id, allow_editing)
}

#[tauri::command]
pub fn lan_share_stop(state: State<'_, AppState>) -> LanShareInfo {
    state.stop_lan_share();
    LanShareInfo::default()
}

#[tauri::command]
pub fn lan_share_status(state: State<'_, AppState>) -> LanShareInfo {
    state
        .lan_share
        .lock()
        .as_ref()
        .map(|runtime| runtime.info.clone())
        .unwrap_or_default()
}

#[tauri::command]
pub fn lan_share_discovered(state: State<'_, AppState>) -> Vec<DiscoveredLanShare> {
    crate::lan_share::discovered_shares(state.inner())
}

#[tauri::command]
pub fn lan_share_open(state: State<'_, AppState>, share_id: String) -> LibrResult<()> {
    crate::lan_share::open_discovered_share(state.inner(), &share_id)
}

#[tauri::command]
pub fn asset_list(state: State<'_, AppState>, query: SearchQuery) -> LibrResult<Vec<Asset>> {
    let guard = state.session.lock();
    let session = guard.as_ref().ok_or(LibrError::NoLibrary)?;
    db::backfill_heif_previews(session)?;
    let blocked = blocked_folder_ids(state.inner(), session)?;
    if let Some(folder_id) = &query.folder_id {
        ensure_folder_accessible(&blocked, folder_id)?;
    }
    let mut assets = db::list_assets_with_blocked_folders(session, &query, &blocked)?;
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
    import_mode: String,
) -> LibrResult<ImportResult> {
    if !matches!(import_mode.as_str(), "map" | "copy" | "move") {
        return Err(LibrError::Other("不支持的导入模式".into()));
    }
    let delete_originals = import_mode == "move";
    let map_external = import_mode == "map";
    if let Some(folder_id) = folder_id.as_deref() {
        let guard = state.session.lock();
        let session = guard.as_ref().ok_or(LibrError::NoLibrary)?;
        ensure_folder_accessible(&blocked_folder_ids(state.inner(), session)?, folder_id)?;
    }
    let library_path = {
        let guard = state.session.lock();
        guard.as_ref().ok_or(LibrError::NoLibrary)?.path.clone()
    };
    let job_id = Uuid::new_v4().to_string();
    emit_progress(
        &app,
        JobProgress {
            job_id: job_id.clone(),
            kind: "import".into(),
            completed: 0,
            total: 0,
            current_item: None,
            phase: "queued".into(),
            message: Some("正在扫描待导入文件…".into()),
        },
    );
    let shared_state = state.inner().clone();
    let job_id_for_worker = job_id.clone();
    let app_for_worker = app.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let files = collect_files(&paths, &library_path);
        let total = files.len();
        let mut imported = Vec::new();
        let mut duplicates = 0usize;
        let mut failed = Vec::new();
        let mut deleted_originals = 0usize;
        let mut source_delete_failures = Vec::new();
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
            if delete_originals && matches!(is_same_file(path, &library_path), Ok(true)) {
                failed.push(FailedImport {
                    path: path.to_string_lossy().to_string(),
                    message: "不能剪切导入当前正在使用的资源库文件".into(),
                });
                continue;
            }
            let result = {
                let mut guard = shared_state.session.lock();
                let session = guard.as_mut().ok_or(LibrError::NoLibrary)?;
                if map_external {
                    db::import_mapped_file(session, path, folder_id.as_deref())
                } else {
                    db::import_file(session, path, folder_id.as_deref())
                }
            };
            match result {
                Ok(result) => {
                    if result.duplicate {
                        duplicates += 1;
                    } else {
                        imported.push(result.asset);
                        if delete_originals {
                            match delete_import_source(path, &library_path) {
                                Ok(()) => deleted_originals += 1,
                                Err(error) => source_delete_failures.push(FailedImport {
                                    path: path.to_string_lossy().to_string(),
                                    message: error.to_string(),
                                }),
                            }
                        }
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
        Ok(ImportResult {
            job_id: job_id_for_worker,
            imported,
            duplicates,
            failed,
            deleted_originals,
            source_delete_failures,
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
    let session = guard.as_ref().ok_or(LibrError::NoLibrary)?;
    let blocked = blocked_folder_ids(state.inner(), session)?;
    db::ensure_assets_accessible(session, std::slice::from_ref(&asset_id), &blocked)?;
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
    let session = guard.as_ref().ok_or(LibrError::NoLibrary)?;
    let blocked = blocked_folder_ids(state.inner(), session)?;
    db::ensure_assets_accessible(session, &asset_ids, &blocked)?;
    db::set_assets_deleted(
        guard.as_mut().ok_or(LibrError::NoLibrary)?,
        &asset_ids,
        true,
    )
}

#[tauri::command]
pub fn asset_restore(state: State<'_, AppState>, asset_ids: Vec<String>) -> LibrResult<()> {
    let mut guard = state.session.lock();
    let session = guard.as_ref().ok_or(LibrError::NoLibrary)?;
    let blocked = blocked_folder_ids(state.inner(), session)?;
    db::ensure_assets_accessible(session, &asset_ids, &blocked)?;
    db::set_assets_deleted(
        guard.as_mut().ok_or(LibrError::NoLibrary)?,
        &asset_ids,
        false,
    )
}

#[tauri::command]
pub fn asset_purge(state: State<'_, AppState>, asset_ids: Vec<String>) -> LibrResult<()> {
    let mut guard = state.session.lock();
    let session = guard.as_ref().ok_or(LibrError::NoLibrary)?;
    let blocked = blocked_folder_ids(state.inner(), session)?;
    db::ensure_assets_accessible(session, &asset_ids, &blocked)?;
    db::purge_assets(guard.as_mut().ok_or(LibrError::NoLibrary)?, &asset_ids)
}

#[tauri::command]
pub fn asset_export(
    state: State<'_, AppState>,
    asset_ids: Vec<String>,
    destination: String,
) -> LibrResult<()> {
    let guard = state.session.lock();
    let session = guard.as_ref().ok_or(LibrError::NoLibrary)?;
    let blocked = blocked_folder_ids(state.inner(), session)?;
    db::ensure_assets_accessible(session, &asset_ids, &blocked)?;
    db::export_assets(
        guard.as_ref().ok_or(LibrError::NoLibrary)?,
        &asset_ids,
        Path::new(&destination),
    )
}

fn safe_drag_filename(display_name: &str) -> String {
    let filename = db::sanitize_filename(display_name.trim());
    if filename == "." || filename == ".." {
        "未命名文件".into()
    } else {
        filename
    }
}

#[tauri::command]
pub async fn asset_prepare_drag(
    app: AppHandle,
    state: State<'_, AppState>,
    asset_ids: Vec<String>,
) -> LibrResult<PreparedAssetDrag> {
    if asset_ids.is_empty() {
        return Err(LibrError::Other("请先选择要拖拽的资源".into()));
    }

    let cache_root = app
        .path()
        .app_cache_dir()
        .map_err(|error| LibrError::Other(error.to_string()))?
        .join("drag");
    let shared_state = state.inner().clone();

    tauri::async_runtime::spawn_blocking(move || {
        let guard = shared_state.session.lock();
        let session = guard.as_ref().ok_or(LibrError::NoLibrary)?;
        let blocked = blocked_folder_ids(&shared_state, session)?;
        db::ensure_assets_accessible(session, &asset_ids, &blocked)?;

        let library_cache = cache_root.join(db::library_info(session)?.id);
        fs::create_dir_all(&library_cache)?;
        let mut paths = Vec::with_capacity(asset_ids.len());

        for asset_id in &asset_ids {
            let asset = db::get_asset(session, asset_id)?;
            if let Some(mapped_path) = db::mapped_asset_path(session, asset_id)? {
                paths.push(mapped_path.to_string_lossy().into_owned());
                continue;
            }
            let asset_cache = library_cache.join(asset_id);
            fs::create_dir_all(&asset_cache)?;
            let destination = asset_cache.join(safe_drag_filename(&asset.display_name));
            let cached_size_matches = destination
                .metadata()
                .map(|metadata| metadata.len() == asset.byte_size as u64)
                .unwrap_or(false);
            if !cached_size_matches {
                let temporary = asset_cache.join("materializing.part");
                let mut target = fs::File::create(&temporary)?;
                db::stream_asset_to_writer(session, asset_id, &mut target)?;
                drop(target);
                if destination.exists() {
                    fs::remove_file(&destination)?;
                }
                fs::rename(temporary, &destination)?;
            }
            paths.push(destination.to_string_lossy().into_owned());
        }

        let first_asset_id = asset_ids
            .first()
            .ok_or_else(|| LibrError::Other("资源不存在".into()))?;
        let preview_path = library_cache.join(format!("{first_asset_id}-drag-preview.jpg"));
        let icon_path = if preview_path.exists() {
            preview_path
        } else {
            let mut preview = fs::File::create(&preview_path)?;
            if db::stream_asset_preview_to_writer(session, first_asset_id, &mut preview)? {
                preview_path
            } else {
                drop(preview);
                let fallback = library_cache.join("libr-drag-icon.png");
                if !fallback.exists() {
                    fs::write(&fallback, include_bytes!("../icons/128x128.png"))?;
                }
                let _ = fs::remove_file(&preview_path);
                fallback
            }
        };

        Ok(PreparedAssetDrag {
            paths,
            icon_path: icon_path.to_string_lossy().into_owned(),
        })
    })
    .await
    .map_err(|error| LibrError::Other(error.to_string()))?
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
    let blocked = blocked_folder_ids(state.inner(), session)?;
    db::ensure_assets_accessible(session, std::slice::from_ref(&asset_id), &blocked)?;
    if let Some(mapped_path) = db::mapped_asset_path(session, &asset_id)? {
        opener::open(mapped_path).map_err(|error| LibrError::Other(error.to_string()))?;
        return Ok(());
    }
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
    let session = guard.as_ref().ok_or(LibrError::NoLibrary)?;
    let unlocked = state.unlocked_folders.lock().clone();
    let owners = db::folder_lock_owners(session, &unlocked)?;
    let mut folders = db::list_folders(session)?;
    for folder in &mut folders {
        folder.lock_owner_id = owners.get(&folder.id).cloned();
        folder.is_locked = folder.lock_owner_id.is_some();
    }
    Ok(folders)
}

#[tauri::command]
pub fn folder_assign_assets(
    state: State<'_, AppState>,
    folder_id: String,
    asset_ids: Vec<String>,
) -> LibrResult<usize> {
    let mut guard = state.session.lock();
    let session = guard.as_ref().ok_or(LibrError::NoLibrary)?;
    ensure_folder_accessible(&blocked_folder_ids(state.inner(), session)?, &folder_id)?;
    db::ensure_assets_accessible(
        session,
        &asset_ids,
        &blocked_folder_ids(state.inner(), session)?,
    )?;
    db::assign_assets_to_folder(
        guard.as_mut().ok_or(LibrError::NoLibrary)?,
        &folder_id,
        &asset_ids,
    )
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
    db::delete_folder(guard.as_mut().ok_or(LibrError::NoLibrary)?, &id)?;
    state.unlocked_folders.lock().remove(&id);
    state.stream_tokens.lock().clear();
    Ok(())
}

#[tauri::command]
pub fn folder_set_password(
    state: State<'_, AppState>,
    id: String,
    password: String,
) -> LibrResult<()> {
    let mut guard = state.session.lock();
    db::set_folder_password(guard.as_mut().ok_or(LibrError::NoLibrary)?, &id, &password)?;
    state.unlocked_folders.lock().remove(&id);
    state.stream_tokens.lock().clear();
    Ok(())
}

#[tauri::command]
pub fn folder_unlock(state: State<'_, AppState>, id: String, password: String) -> LibrResult<bool> {
    let guard = state.session.lock();
    let verified =
        db::verify_folder_password(guard.as_ref().ok_or(LibrError::NoLibrary)?, &id, &password)?;
    if verified {
        state.unlocked_folders.lock().insert(id);
    }
    Ok(verified)
}

#[tauri::command]
pub fn folder_lock(state: State<'_, AppState>, id: String) -> LibrResult<()> {
    let guard = state.session.lock();
    let folder = db::list_folders(guard.as_ref().ok_or(LibrError::NoLibrary)?)?
        .into_iter()
        .find(|folder| folder.id == id)
        .ok_or_else(|| LibrError::Other("文件夹不存在".into()))?;
    if !folder.is_encrypted {
        return Err(LibrError::Other("文件夹尚未加密".into()));
    }
    state.unlocked_folders.lock().remove(&id);
    state.stream_tokens.lock().clear();
    Ok(())
}

#[tauri::command]
pub fn folder_clear_password(
    state: State<'_, AppState>,
    id: String,
    password: String,
) -> LibrResult<bool> {
    let mut guard = state.session.lock();
    let cleared =
        db::clear_folder_password(guard.as_mut().ok_or(LibrError::NoLibrary)?, &id, &password)?;
    if cleared {
        state.unlocked_folders.lock().remove(&id);
        state.stream_tokens.lock().clear();
    }
    Ok(cleared)
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

#[cfg(test)]
mod tests {
    use super::{collect_files, delete_import_source, safe_drag_filename};
    use std::fs;

    #[test]
    fn collects_every_file_from_nested_import_folders() {
        let temporary = tempfile::tempdir().unwrap();
        let nested = temporary.path().join("first").join("second");
        fs::create_dir_all(&nested).unwrap();
        let root_file = temporary.path().join("root.jpg");
        let nested_file = nested.join("nested.txt");
        fs::write(&root_file, b"root").unwrap();
        fs::write(&nested_file, b"nested").unwrap();

        let library = temporary.path().join("library.libr");
        let files = collect_files(&[temporary.path().to_string_lossy().into_owned()], &library);

        assert_eq!(files, vec![nested_file, root_file]);
    }

    #[test]
    fn recursive_import_excludes_the_open_library_and_its_sidecars() {
        let temporary = tempfile::tempdir().unwrap();
        let library = temporary.path().join("library.libr");
        let journal = temporary.path().join("library.libr-journal");
        let wal = temporary.path().join("library.libr-wal");
        let shm = temporary.path().join("library.libr-shm");
        let source = temporary.path().join("source.mov");
        for path in [&library, &journal, &wal, &shm, &source] {
            fs::write(path, b"data").unwrap();
        }

        let files = collect_files(&[temporary.path().to_string_lossy().into_owned()], &library);

        assert_eq!(files, vec![source]);
    }

    #[test]
    fn cut_import_deletes_regular_sources_but_preserves_the_open_library() {
        let temporary = tempfile::tempdir().unwrap();
        let library = temporary.path().join("library.libr");
        let source = temporary.path().join("source.txt");
        fs::write(&library, b"library").unwrap();
        fs::write(&source, b"source").unwrap();

        delete_import_source(&source, &library).unwrap();
        assert!(!source.exists());

        let error = delete_import_source(&library, &library).unwrap_err();
        assert!(error.to_string().contains("不能删除"));
        assert!(library.exists());
    }

    #[test]
    fn makes_drag_cache_filenames_safe() {
        assert_eq!(safe_drag_filename("design/final.psd"), "design_final.psd");
        assert_eq!(safe_drag_filename("design:final.psd"), "design_final.psd");
        assert_eq!(safe_drag_filename(".."), "未命名文件");
        assert_eq!(safe_drag_filename("   "), "未命名文件");
    }
}
