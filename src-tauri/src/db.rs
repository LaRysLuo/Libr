use std::{
    collections::{HashMap, HashSet},
    fs::{self, File},
    io::{Cursor, Read, Write},
    path::{Path, PathBuf},
    time::SystemTime,
};

use chrono::{DateTime, Duration, Utc};
use image::imageops::FilterType;
use rusqlite::{
    backup::Backup, params, params_from_iter, types::Value, Connection, OpenFlags,
    OptionalExtension,
};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    error::{LibrError, LibrResult},
    models::{Asset, AssetKind, AssetPatch, Folder, LibraryInfo, SearchQuery, SmartFolder, Tag},
};

pub const SCHEMA_VERSION: i64 = 2;
pub const APPLICATION_ID: i64 = 0x4C49_4252;

pub struct LibrarySession {
    pub conn: Connection,
    pub path: PathBuf,
    pub read_only: bool,
}

pub struct ImportOneResult {
    pub asset: Asset,
    pub duplicate: bool,
}

pub fn create_library(path: &Path, name: &str) -> LibrResult<LibrarySession> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    if path.exists() {
        return Err(LibrError::Other("目标资源库已存在".into()));
    }
    let mut conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_WRITE
            | OpenFlags::SQLITE_OPEN_CREATE
            | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    configure_writable(&conn)?;
    initialize_schema(&mut conn, name)?;
    acquire_exclusive_session(&conn)?;
    Ok(LibrarySession {
        conn,
        path: path.to_path_buf(),
        read_only: false,
    })
}

pub fn open_library(path: &Path) -> LibrResult<LibrarySession> {
    if !path.exists() || !path.is_file() {
        return Err(LibrError::Other("资源库文件不存在".into()));
    }

    let writable = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    );

    let (conn, lock_acquired) = match writable {
        Ok(conn) => {
            configure_writable(&conn)?;
            let locked = acquire_exclusive_session(&conn).is_ok();
            (conn, locked)
        }
        Err(_) => (
            Connection::open_with_flags(
                path,
                OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
            )?,
            false,
        ),
    };

    let application_id: i64 = conn.pragma_query_value(None, "application_id", |row| row.get(0))?;
    if application_id != APPLICATION_ID {
        return Err(LibrError::InvalidLibrary);
    }
    let mut schema_version: i64 =
        conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if lock_acquired && schema_version < SCHEMA_VERSION {
        migrate_schema(&conn, schema_version)?;
        schema_version = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
    }
    let read_only = !lock_acquired || schema_version > SCHEMA_VERSION;
    if read_only {
        conn.pragma_update(None, "query_only", true)?;
    }
    conn.pragma_update(None, "foreign_keys", true)?;
    Ok(LibrarySession {
        conn,
        path: path.to_path_buf(),
        read_only,
    })
}

fn configure_writable(conn: &Connection) -> LibrResult<()> {
    conn.execute_batch(
        "PRAGMA foreign_keys = ON;
         PRAGMA journal_mode = DELETE;
         PRAGMA synchronous = FULL;
         PRAGMA temp_store = MEMORY;
         PRAGMA cache_size = -32768;
         PRAGMA busy_timeout = 1500;",
    )?;
    Ok(())
}

fn acquire_exclusive_session(conn: &Connection) -> LibrResult<()> {
    conn.execute_batch("PRAGMA locking_mode = EXCLUSIVE; BEGIN EXCLUSIVE; COMMIT;")?;
    Ok(())
}

fn migrate_schema(conn: &Connection, from_version: i64) -> LibrResult<()> {
    if from_version < 2 {
        conn.execute_batch(
            "BEGIN IMMEDIATE;
             ALTER TABLE folders ADD COLUMN password_hash TEXT;
             PRAGMA user_version = 2;
             COMMIT;",
        )?;
    }
    Ok(())
}

fn initialize_schema(conn: &mut Connection, name: &str) -> LibrResult<()> {
    conn.execute_batch(&format!(
        "PRAGMA application_id = {APPLICATION_ID};
         PRAGMA user_version = {SCHEMA_VERSION};
         CREATE TABLE library_meta (
           key TEXT PRIMARY KEY,
           value TEXT NOT NULL
         );
         CREATE TABLE blobs (
           id TEXT PRIMARY KEY,
           sha256 TEXT NOT NULL UNIQUE,
           byte_size INTEGER NOT NULL CHECK(byte_size >= 0),
           mime TEXT NOT NULL,
           data BLOB NOT NULL
         );
         CREATE TABLE assets (
           id TEXT PRIMARY KEY,
           blob_id TEXT NOT NULL REFERENCES blobs(id) ON DELETE RESTRICT,
           display_name TEXT NOT NULL,
           extension TEXT NOT NULL,
           kind TEXT NOT NULL,
           mime TEXT NOT NULL,
           byte_size INTEGER NOT NULL,
           width INTEGER,
           height INTEGER,
           duration_ms INTEGER,
           rating INTEGER NOT NULL DEFAULT 0 CHECK(rating BETWEEN 0 AND 5),
           favorite INTEGER NOT NULL DEFAULT 0 CHECK(favorite IN (0, 1)),
           color_label TEXT,
           dominant_color TEXT,
           notes TEXT NOT NULL DEFAULT '',
           source_path TEXT NOT NULL DEFAULT '',
           imported_at TEXT NOT NULL,
           created_at TEXT NOT NULL,
           deleted_at TEXT
         );
         CREATE INDEX idx_assets_blob ON assets(blob_id);
         CREATE INDEX idx_assets_kind ON assets(kind, deleted_at);
         CREATE INDEX idx_assets_imported ON assets(imported_at DESC);
         CREATE TABLE folders (
           id TEXT PRIMARY KEY,
           parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
           name TEXT NOT NULL,
           sort_order INTEGER NOT NULL DEFAULT 0,
           created_at TEXT NOT NULL,
           password_hash TEXT,
           UNIQUE(parent_id, name)
         );
         CREATE TABLE asset_folders (
           asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
           folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
           PRIMARY KEY(asset_id, folder_id)
         );
         CREATE INDEX idx_asset_folders_folder ON asset_folders(folder_id, asset_id);
         CREATE TABLE tags (
           id TEXT PRIMARY KEY,
           name TEXT NOT NULL UNIQUE COLLATE NOCASE,
           color TEXT,
           created_at TEXT NOT NULL
         );
         CREATE TABLE asset_tags (
           asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
           tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
           PRIMARY KEY(asset_id, tag_id)
         );
         CREATE TABLE smart_folders (
           id TEXT PRIMARY KEY,
           name TEXT NOT NULL,
           query_json TEXT NOT NULL,
           sort_order INTEGER NOT NULL DEFAULT 0,
           created_at TEXT NOT NULL
         );
         CREATE TABLE previews (
           asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
           kind TEXT NOT NULL,
           width INTEGER,
           height INTEGER,
           mime TEXT NOT NULL,
           data BLOB NOT NULL,
           PRIMARY KEY(asset_id, kind)
         );
         CREATE TABLE trash (
           asset_id TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
           deleted_at TEXT NOT NULL
         );
         CREATE VIRTUAL TABLE asset_search USING fts5(
           asset_id UNINDEXED,
           display_name,
           notes,
           source_path,
           tags,
           tokenize = 'trigram case_sensitive 0'
         );"
    ))?;

    let transaction = conn.transaction()?;
    let now = Utc::now().to_rfc3339();
    let values = [
        ("id", Uuid::new_v4().to_string()),
        ("name", name.to_owned()),
        ("created_at", now.clone()),
        ("updated_at", now),
        ("format", "libr-sqlite-v1".to_owned()),
    ];
    for (key, value) in values {
        transaction.execute(
            "INSERT INTO library_meta(key, value) VALUES (?1, ?2)",
            params![key, value],
        )?;
    }
    transaction.commit()?;
    Ok(())
}

pub fn library_info(session: &LibrarySession) -> LibrResult<LibraryInfo> {
    let get_meta = |key: &str| -> LibrResult<String> {
        Ok(session.conn.query_row(
            "SELECT value FROM library_meta WHERE key = ?1",
            [key],
            |row| row.get(0),
        )?)
    };
    let recent_after = (Utc::now() - Duration::days(30)).to_rfc3339();
    let (asset_count, recent_count, unfiled_count, favorite_count, duplicate_count, trash_count) =
        session.conn.query_row(
            "SELECT
                COUNT(CASE WHEN a.deleted_at IS NULL THEN 1 END),
                COUNT(CASE WHEN a.deleted_at IS NULL AND a.imported_at >= ?1 THEN 1 END),
                COUNT(CASE WHEN a.deleted_at IS NULL AND NOT EXISTS (
                    SELECT 1 FROM asset_folders af WHERE af.asset_id = a.id
                ) THEN 1 END),
                COUNT(CASE WHEN a.deleted_at IS NULL AND a.favorite = 1 THEN 1 END),
                COUNT(CASE WHEN a.deleted_at IS NULL AND EXISTS (
                    SELECT 1 FROM assets d WHERE d.blob_id = a.blob_id AND d.id <> a.id
                ) THEN 1 END),
                COUNT(CASE WHEN a.deleted_at IS NOT NULL THEN 1 END)
             FROM assets a",
            [&recent_after],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            },
        )?;
    let total_bytes: i64 =
        session
            .conn
            .query_row("SELECT COALESCE(SUM(byte_size), 0) FROM blobs", [], |row| {
                row.get(0)
            })?;
    let schema_version: i64 = session
        .conn
        .pragma_query_value(None, "user_version", |row| row.get(0))?;
    Ok(LibraryInfo {
        id: get_meta("id")?,
        name: get_meta("name")?,
        path: session.path.to_string_lossy().to_string(),
        schema_version,
        read_only: session.read_only,
        asset_count,
        recent_count,
        unfiled_count,
        favorite_count,
        duplicate_count,
        trash_count,
        total_bytes,
        created_at: get_meta("created_at")?,
        updated_at: get_meta("updated_at")?,
    })
}

pub fn backup_library(session: &LibrarySession, destination: &Path) -> LibrResult<()> {
    if destination.exists() {
        return Err(LibrError::Other("目标文件已存在".into()));
    }
    let mut target = Connection::open(destination)?;
    let backup = Backup::new(&session.conn, &mut target)?;
    backup.run_to_completion(16, std::time::Duration::from_millis(10), None)?;
    Ok(())
}

pub fn integrity_check(session: &LibrarySession) -> LibrResult<Vec<String>> {
    let mut statement = session.conn.prepare("PRAGMA integrity_check")?;
    let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

#[cfg(test)]
pub fn list_assets(session: &LibrarySession, query: &SearchQuery) -> LibrResult<Vec<Asset>> {
    list_assets_with_blocked_folders(session, query, &HashSet::new())
}

pub fn list_assets_with_blocked_folders(
    session: &LibrarySession,
    query: &SearchQuery,
    blocked_folder_ids: &HashSet<String>,
) -> LibrResult<Vec<Asset>> {
    let mut sql = String::from(
        "SELECT a.id, a.display_name, a.extension, a.kind, a.mime, a.byte_size,
                a.width, a.height, a.duration_ms, a.rating, a.favorite, a.color_label,
                a.dominant_color, a.notes, a.source_path, a.imported_at, a.created_at,
                a.deleted_at,
                (SELECT MAX(COUNT(*) - 1, 0) FROM assets d WHERE d.blob_id = a.blob_id) AS duplicate_count
         FROM assets a WHERE ",
    );
    sql.push_str(if query.deleted.unwrap_or(false) {
        "a.deleted_at IS NOT NULL"
    } else {
        "a.deleted_at IS NULL"
    });
    let mut values: Vec<Value> = Vec::new();

    if !blocked_folder_ids.is_empty() {
        sql.push_str(" AND NOT EXISTS (SELECT 1 FROM asset_folders protected_af WHERE protected_af.asset_id = a.id AND protected_af.folder_id IN (");
        sql.push_str(&vec!["?"; blocked_folder_ids.len()].join(","));
        sql.push_str("))");
        values.extend(blocked_folder_ids.iter().cloned().map(Value::Text));
    }

    if let Some(text) = query.text.as_ref().filter(|value| !value.trim().is_empty()) {
        if text.trim().chars().count() >= 3 {
            sql.push_str(
                " AND a.id IN (SELECT asset_id FROM asset_search WHERE asset_search MATCH ?)",
            );
            values.push(Value::Text(format!(
                "\"{}\"",
                text.trim().replace('"', "\"\"")
            )));
        } else {
            sql.push_str(" AND (a.display_name LIKE ? ESCAPE '\\' OR a.notes LIKE ? ESCAPE '\\' OR a.source_path LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM asset_tags at JOIN tags t ON t.id = at.tag_id WHERE at.asset_id = a.id AND t.name LIKE ? ESCAPE '\\'))");
            let pattern = format!("%{}%", escape_like(text.trim()));
            for _ in 0..4 {
                values.push(Value::Text(pattern.clone()));
            }
        }
    }
    if let Some(folder_id) = &query.folder_id {
        sql.push_str(" AND EXISTS (SELECT 1 FROM asset_folders af WHERE af.asset_id = a.id AND af.folder_id = ?)");
        values.push(Value::Text(folder_id.clone()));
    }
    if let Some(kinds) = &query.kinds {
        if !kinds.is_empty() {
            sql.push_str(" AND a.kind IN (");
            sql.push_str(&vec!["?"; kinds.len()].join(","));
            sql.push(')');
            values.extend(
                kinds
                    .iter()
                    .map(|kind| Value::Text(kind.as_str().to_owned())),
            );
        }
    }
    if let Some(tag_ids) = &query.tag_ids {
        for tag_id in tag_ids {
            sql.push_str(" AND EXISTS (SELECT 1 FROM asset_tags at WHERE at.asset_id = a.id AND at.tag_id = ?)");
            values.push(Value::Text(tag_id.clone()));
        }
    }
    if query.favorite == Some(true) {
        sql.push_str(" AND a.favorite = 1");
    }
    if let Some(rating) = query.min_rating.filter(|value| *value > 0) {
        sql.push_str(" AND a.rating >= ?");
        values.push(Value::Integer(rating));
    }
    if let Some(color) = &query.color_label {
        sql.push_str(" AND a.color_label = ?");
        values.push(Value::Text(color.clone()));
    }
    if query.unfiled == Some(true) {
        sql.push_str(" AND NOT EXISTS (SELECT 1 FROM asset_folders af WHERE af.asset_id = a.id)");
    }
    if query.untagged == Some(true) {
        sql.push_str(" AND NOT EXISTS (SELECT 1 FROM asset_tags at WHERE at.asset_id = a.id)");
    }
    if query.duplicates == Some(true) {
        sql.push_str(
            " AND EXISTS (SELECT 1 FROM assets d WHERE d.blob_id = a.blob_id AND d.id <> a.id)",
        );
    }
    if let Some(value) = query.min_byte_size {
        sql.push_str(" AND a.byte_size >= ?");
        values.push(Value::Integer(value.max(0)));
    }
    if let Some(value) = query.max_byte_size {
        sql.push_str(" AND a.byte_size <= ?");
        values.push(Value::Integer(value.max(0)));
    }
    if let Some(value) = &query.imported_after {
        sql.push_str(" AND a.imported_at >= ?");
        values.push(Value::Text(value.clone()));
    }
    if let Some(value) = &query.imported_before {
        sql.push_str(" AND a.imported_at < ?");
        values.push(Value::Text(value.clone()));
    }
    match query.aspect_ratio.as_deref() {
        Some("landscape") => sql.push_str(" AND a.width IS NOT NULL AND a.height IS NOT NULL AND a.width > a.height"),
        Some("portrait") => sql.push_str(" AND a.width IS NOT NULL AND a.height IS NOT NULL AND a.width < a.height"),
        Some("square") => sql.push_str(" AND a.width IS NOT NULL AND a.height IS NOT NULL AND ABS(a.width - a.height) <= MAX(a.width, a.height) * 0.05"),
        _ => {}
    }

    let sort_column = match query.sort_by.as_deref() {
        Some("createdAt") => "a.created_at",
        Some("name") => "a.display_name COLLATE NOCASE",
        Some("size") => "a.byte_size",
        Some("rating") => "a.rating",
        _ => "a.imported_at",
    };
    let direction = if query.sort_direction.as_deref() == Some("asc") {
        "ASC"
    } else {
        "DESC"
    };
    sql.push_str(&format!(
        " ORDER BY {sort_column} {direction}, a.id ASC LIMIT ? OFFSET ?"
    ));
    values.push(Value::Integer(query.limit.unwrap_or(1000).clamp(1, 5000)));
    values.push(Value::Integer(query.offset.unwrap_or(0).max(0)));

    let mut statement = session.conn.prepare(&sql)?;
    let rows = statement.query_map(params_from_iter(values), base_asset_from_row)?;
    let mut assets = rows.collect::<Result<Vec<_>, _>>()?;
    hydrate_assets(&session.conn, &mut assets)?;
    Ok(assets)
}

pub fn get_asset(session: &LibrarySession, asset_id: &str) -> LibrResult<Asset> {
    let mut asset = session
        .conn
        .query_row(
            "SELECT a.id, a.display_name, a.extension, a.kind, a.mime, a.byte_size,
                a.width, a.height, a.duration_ms, a.rating, a.favorite, a.color_label,
                a.dominant_color, a.notes, a.source_path, a.imported_at, a.created_at,
                a.deleted_at,
                (SELECT MAX(COUNT(*) - 1, 0) FROM assets d WHERE d.blob_id = a.blob_id)
         FROM assets a WHERE a.id = ?1",
            [asset_id],
            base_asset_from_row,
        )
        .optional()?
        .ok_or(LibrError::AssetNotFound)?;
    hydrate_assets(&session.conn, std::slice::from_mut(&mut asset))?;
    Ok(asset)
}

fn base_asset_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Asset> {
    let id: String = row.get(0)?;
    Ok(Asset {
        preview_url: Some(format!("libr://localhost/preview/{id}")),
        asset_url: Some(format!("libr://localhost/asset/{id}")),
        stream_token: None,
        id,
        display_name: row.get(1)?,
        extension: row.get(2)?,
        kind: AssetKind::from_db(&row.get::<_, String>(3)?),
        mime: row.get(4)?,
        byte_size: row.get(5)?,
        width: row.get(6)?,
        height: row.get(7)?,
        duration_ms: row.get(8)?,
        rating: row.get(9)?,
        favorite: row.get::<_, i64>(10)? != 0,
        color_label: row.get(11)?,
        dominant_color: row.get(12)?,
        notes: row.get(13)?,
        source_path: row.get(14)?,
        imported_at: row.get(15)?,
        created_at: row.get(16)?,
        deleted_at: row.get(17)?,
        duplicate_count: row.get(18)?,
        folder_ids: vec![],
        tags: vec![],
    })
}

fn hydrate_assets(conn: &Connection, assets: &mut [Asset]) -> LibrResult<()> {
    let mut tag_statement = conn.prepare(
        "SELECT t.id, t.name, t.color FROM tags t JOIN asset_tags at ON at.tag_id = t.id WHERE at.asset_id = ?1 ORDER BY t.name COLLATE NOCASE",
    )?;
    let mut folder_statement =
        conn.prepare("SELECT folder_id FROM asset_folders WHERE asset_id = ?1")?;
    for asset in assets {
        asset.tags = tag_statement
            .query_map([&asset.id], |row| {
                Ok(Tag {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    color: row.get(2)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        asset.folder_ids = folder_statement
            .query_map([&asset.id], |row| row.get(0))?
            .collect::<Result<Vec<String>, _>>()?;
        let has_preview: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM previews WHERE asset_id = ?1 AND kind = 'thumbnail')",
            [&asset.id],
            |row| row.get(0),
        )?;
        if !has_preview {
            asset.preview_url = None;
        }
    }
    Ok(())
}

pub fn import_file(
    session: &mut LibrarySession,
    path: &Path,
    folder_id: Option<&str>,
) -> LibrResult<ImportOneResult> {
    if session.read_only {
        return Err(LibrError::ReadOnly);
    }
    if !path.is_file() {
        return Err(LibrError::Other("不是可导入的文件".into()));
    }
    let metadata = fs::metadata(path)?;
    let byte_size =
        i64::try_from(metadata.len()).map_err(|_| LibrError::Other("文件过大".into()))?;
    let sha256 = hash_file(path)?;

    if let Some((asset_id, _blob_id)) = session.conn.query_row(
        "SELECT a.id, a.blob_id FROM assets a JOIN blobs b ON b.id = a.blob_id WHERE b.sha256 = ?1 ORDER BY a.deleted_at IS NULL DESC LIMIT 1",
        [&sha256],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
    ).optional()? {
        if let Some(folder_id) = folder_id {
            session.conn.execute("INSERT OR IGNORE INTO asset_folders(asset_id, folder_id) VALUES (?1, ?2)", params![asset_id, folder_id])?;
        }
        return Ok(ImportOneResult { asset: get_asset(session, &asset_id)?, duplicate: true });
    }

    let display_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("未命名文件")
        .to_owned();
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_uppercase();
    let mime = mime_guess::from_path(path)
        .first_or_octet_stream()
        .essence_str()
        .to_owned();
    let kind = classify_asset(&extension, &mime);
    let source_path = path.to_string_lossy().to_string();
    let imported_at = Utc::now().to_rfc3339();
    let created_at = metadata
        .modified()
        .ok()
        .map(system_time_to_rfc3339)
        .unwrap_or_else(|| imported_at.clone());
    let preview = if kind == AssetKind::Image {
        generate_image_preview(path).ok()
    } else {
        None
    };
    let (width, height, dominant_color) = preview
        .as_ref()
        .map(|(_, width, height, color)| {
            (
                Some(*width as i64),
                Some(*height as i64),
                Some(color.clone()),
            )
        })
        .unwrap_or((None, None, None));

    let blob_id = Uuid::new_v4().to_string();
    let asset_id = Uuid::new_v4().to_string();
    let transaction = session.conn.transaction()?;
    transaction.execute(
        "INSERT INTO blobs(id, sha256, byte_size, mime, data) VALUES (?1, ?2, ?3, ?4, zeroblob(?3))",
        params![blob_id, sha256, byte_size, mime],
    )?;
    let blob_rowid: i64 =
        transaction.query_row("SELECT rowid FROM blobs WHERE id = ?1", [&blob_id], |row| {
            row.get(0)
        })?;
    {
        let mut source = File::open(path)?;
        let mut target = transaction.blob_open("main", "blobs", "data", blob_rowid, false)?;
        std::io::copy(&mut source, &mut target)?;
    }
    transaction.execute(
        "INSERT INTO assets(id, blob_id, display_name, extension, kind, mime, byte_size, width, height, dominant_color, source_path, imported_at, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        params![asset_id, blob_id, display_name, extension, kind.as_str(), mime, byte_size, width, height, dominant_color, source_path, imported_at, created_at],
    )?;
    if let Some(folder_id) = folder_id {
        transaction.execute(
            "INSERT INTO asset_folders(asset_id, folder_id) VALUES (?1, ?2)",
            params![asset_id, folder_id],
        )?;
    }
    if let Some((data, preview_width, preview_height, _)) = preview {
        transaction.execute(
            "INSERT INTO previews(asset_id, kind, width, height, mime, data) VALUES (?1, 'thumbnail', ?2, ?3, 'image/jpeg', ?4)",
            params![asset_id, preview_width, preview_height, data],
        )?;
    }
    transaction.execute(
        "INSERT INTO asset_search(asset_id, display_name, notes, source_path, tags) VALUES (?1, ?2, '', ?3, '')",
        params![asset_id, display_name, source_path],
    )?;
    touch_library(&transaction)?;
    transaction.commit()?;
    Ok(ImportOneResult {
        asset: get_asset(session, &asset_id)?,
        duplicate: false,
    })
}

pub fn update_asset(
    session: &mut LibrarySession,
    asset_id: &str,
    patch: &AssetPatch,
) -> LibrResult<Asset> {
    if session.read_only {
        return Err(LibrError::ReadOnly);
    }
    let transaction = session.conn.transaction()?;
    if let Some(value) = &patch.display_name {
        transaction.execute(
            "UPDATE assets SET display_name = ?1 WHERE id = ?2",
            params![value.trim(), asset_id],
        )?;
    }
    if let Some(value) = patch.rating {
        transaction.execute(
            "UPDATE assets SET rating = ?1 WHERE id = ?2",
            params![value.clamp(0, 5), asset_id],
        )?;
    }
    if let Some(value) = patch.favorite {
        transaction.execute(
            "UPDATE assets SET favorite = ?1 WHERE id = ?2",
            params![value as i64, asset_id],
        )?;
    }
    if let Some(value) = &patch.color_label {
        transaction.execute(
            "UPDATE assets SET color_label = ?1 WHERE id = ?2",
            params![value, asset_id],
        )?;
    }
    if patch.clear_color_label == Some(true) {
        transaction.execute(
            "UPDATE assets SET color_label = NULL WHERE id = ?1",
            [asset_id],
        )?;
    }
    if let Some(value) = &patch.notes {
        transaction.execute(
            "UPDATE assets SET notes = ?1 WHERE id = ?2",
            params![value, asset_id],
        )?;
    }
    if let Some(tag_ids) = &patch.tag_ids {
        transaction.execute("DELETE FROM asset_tags WHERE asset_id = ?1", [asset_id])?;
        for tag_id in tag_ids {
            transaction.execute(
                "INSERT OR IGNORE INTO asset_tags(asset_id, tag_id) VALUES (?1, ?2)",
                params![asset_id, tag_id],
            )?;
        }
    }
    if let Some(folder_ids) = &patch.folder_ids {
        transaction.execute("DELETE FROM asset_folders WHERE asset_id = ?1", [asset_id])?;
        for folder_id in folder_ids {
            transaction.execute(
                "INSERT OR IGNORE INTO asset_folders(asset_id, folder_id) VALUES (?1, ?2)",
                params![asset_id, folder_id],
            )?;
        }
    }
    refresh_search_row(&transaction, asset_id)?;
    touch_library(&transaction)?;
    transaction.commit()?;
    get_asset(session, asset_id)
}

pub fn set_assets_deleted(
    session: &mut LibrarySession,
    asset_ids: &[String],
    deleted: bool,
) -> LibrResult<()> {
    if session.read_only {
        return Err(LibrError::ReadOnly);
    }
    let transaction = session.conn.transaction()?;
    for asset_id in asset_ids {
        if deleted {
            let timestamp = Utc::now().to_rfc3339();
            transaction.execute(
                "UPDATE assets SET deleted_at = ?1 WHERE id = ?2",
                params![timestamp, asset_id],
            )?;
            transaction.execute(
                "INSERT OR REPLACE INTO trash(asset_id, deleted_at) VALUES (?1, ?2)",
                params![asset_id, timestamp],
            )?;
        } else {
            transaction.execute(
                "UPDATE assets SET deleted_at = NULL WHERE id = ?1",
                [asset_id],
            )?;
            transaction.execute("DELETE FROM trash WHERE asset_id = ?1", [asset_id])?;
        }
    }
    touch_library(&transaction)?;
    transaction.commit()?;
    Ok(())
}

pub fn purge_assets(session: &mut LibrarySession, asset_ids: &[String]) -> LibrResult<()> {
    if session.read_only {
        return Err(LibrError::ReadOnly);
    }
    let transaction = session.conn.transaction()?;
    let mut blob_ids = HashSet::new();
    for asset_id in asset_ids {
        let blob_id: Option<String> = transaction
            .query_row(
                "SELECT blob_id FROM assets WHERE id = ?1 AND deleted_at IS NOT NULL",
                [asset_id],
                |row| row.get(0),
            )
            .optional()?;
        if let Some(blob_id) = blob_id {
            blob_ids.insert(blob_id);
            transaction.execute("DELETE FROM asset_search WHERE asset_id = ?1", [asset_id])?;
            transaction.execute("DELETE FROM assets WHERE id = ?1", [asset_id])?;
        }
    }
    for blob_id in blob_ids {
        transaction.execute("DELETE FROM blobs WHERE id = ?1 AND NOT EXISTS (SELECT 1 FROM assets WHERE blob_id = ?1)", [&blob_id])?;
    }
    touch_library(&transaction)?;
    transaction.commit()?;
    Ok(())
}

pub fn list_folders(session: &LibrarySession) -> LibrResult<Vec<Folder>> {
    let schema_version: i64 = session
        .conn
        .pragma_query_value(None, "user_version", |row| row.get(0))?;
    let encryption_column = if schema_version >= 2 {
        "f.password_hash IS NOT NULL"
    } else {
        "0"
    };
    let sql = format!(
        "SELECT f.id, f.parent_id, f.name, COUNT(a.id), f.sort_order, {encryption_column}
         FROM folders f LEFT JOIN asset_folders af ON af.folder_id = f.id
         LEFT JOIN assets a ON a.id = af.asset_id AND a.deleted_at IS NULL
         GROUP BY f.id ORDER BY f.parent_id IS NOT NULL, f.sort_order, f.name COLLATE NOCASE"
    );
    let mut statement = session.conn.prepare(&sql)?;
    let folders = statement
        .query_map([], |row| {
            let is_encrypted = row.get::<_, i64>(5)? != 0;
            Ok(Folder {
                id: row.get(0)?,
                parent_id: row.get(1)?,
                name: row.get(2)?,
                item_count: row.get(3)?,
                sort_order: row.get(4)?,
                is_encrypted,
                is_locked: is_encrypted,
                lock_owner_id: None,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(folders)
}

pub fn folder_lock_owners(
    session: &LibrarySession,
    unlocked_folder_ids: &HashSet<String>,
) -> LibrResult<HashMap<String, String>> {
    let folders = list_folders(session)?;
    let parent_by_id: HashMap<String, Option<String>> = folders
        .iter()
        .map(|folder| (folder.id.clone(), folder.parent_id.clone()))
        .collect();
    let encrypted_ids: HashSet<String> = folders
        .iter()
        .filter(|folder| folder.is_encrypted && !unlocked_folder_ids.contains(&folder.id))
        .map(|folder| folder.id.clone())
        .collect();
    let mut owners = HashMap::new();

    for folder in &folders {
        let mut lineage = Vec::new();
        let mut cursor = Some(folder.id.clone());
        let mut visited = HashSet::new();
        while let Some(id) = cursor {
            if !visited.insert(id.clone()) {
                break;
            }
            lineage.push(id.clone());
            cursor = parent_by_id.get(&id).cloned().flatten();
        }
        lineage.reverse();
        if let Some(owner_id) = lineage.into_iter().find(|id| encrypted_ids.contains(id)) {
            owners.insert(folder.id.clone(), owner_id);
        }
    }
    Ok(owners)
}

pub fn ensure_assets_accessible(
    session: &LibrarySession,
    asset_ids: &[String],
    blocked_folder_ids: &HashSet<String>,
) -> LibrResult<()> {
    if blocked_folder_ids.is_empty() || asset_ids.is_empty() {
        return Ok(());
    }
    let mut statement = session
        .conn
        .prepare("SELECT folder_id FROM asset_folders WHERE asset_id = ?1")?;
    for asset_id in asset_ids {
        let folder_ids = statement
            .query_map([asset_id], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        if folder_ids.iter().any(|id| blocked_folder_ids.contains(id)) {
            return Err(LibrError::Other("文件夹已锁定，请先输入密码解锁".into()));
        }
    }
    Ok(())
}

const PASSWORD_HASH_ROUNDS: usize = 25_000;

fn validate_folder_password(password: &str) -> LibrResult<()> {
    if password.trim() != password || password.chars().count() != 8 {
        return Err(LibrError::Other(
            "密码必须正好为 8 位，且不能包含首尾空格".into(),
        ));
    }
    Ok(())
}

fn derive_folder_password(password: &str, salt: &str) -> String {
    let mut digest = Sha256::digest(format!("{salt}:{password}").as_bytes()).to_vec();
    for _ in 1..PASSWORD_HASH_ROUNDS {
        let mut hasher = Sha256::new();
        hasher.update(salt.as_bytes());
        hasher.update(&digest);
        digest = hasher.finalize().to_vec();
    }
    hex::encode(digest)
}

fn folder_password_record(session: &LibrarySession, id: &str) -> LibrResult<Option<String>> {
    session
        .conn
        .query_row(
            "SELECT password_hash FROM folders WHERE id = ?1",
            [id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or_else(|| LibrError::Other("文件夹不存在".into()))
}

fn verify_folder_password_record(record: &str, password: &str) -> bool {
    let mut parts = record.split('$');
    let (Some("v1"), Some(salt), Some(expected), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return false;
    };
    let actual = derive_folder_password(password, salt);
    actual.len() == expected.len()
        && actual
            .as_bytes()
            .iter()
            .zip(expected.as_bytes())
            .fold(0_u8, |difference, (left, right)| {
                difference | (left ^ right)
            })
            == 0
}

pub fn set_folder_password(
    session: &mut LibrarySession,
    id: &str,
    password: &str,
) -> LibrResult<()> {
    if session.read_only {
        return Err(LibrError::ReadOnly);
    }
    validate_folder_password(password)?;
    if folder_password_record(session, id)?.is_some() {
        return Err(LibrError::Other("文件夹已经加密".into()));
    }
    let salt = Uuid::new_v4().simple().to_string();
    let record = format!("v1${salt}${}", derive_folder_password(password, &salt));
    session.conn.execute(
        "UPDATE folders SET password_hash = ?1 WHERE id = ?2",
        params![record, id],
    )?;
    touch_library(&session.conn)?;
    Ok(())
}

pub fn verify_folder_password(
    session: &LibrarySession,
    id: &str,
    password: &str,
) -> LibrResult<bool> {
    validate_folder_password(password)?;
    Ok(folder_password_record(session, id)?
        .as_deref()
        .is_some_and(|record| verify_folder_password_record(record, password)))
}

pub fn clear_folder_password(
    session: &mut LibrarySession,
    id: &str,
    password: &str,
) -> LibrResult<bool> {
    if session.read_only {
        return Err(LibrError::ReadOnly);
    }
    if !verify_folder_password(session, id, password)? {
        return Ok(false);
    }
    session.conn.execute(
        "UPDATE folders SET password_hash = NULL WHERE id = ?1",
        [id],
    )?;
    touch_library(&session.conn)?;
    Ok(true)
}

pub fn assign_assets_to_folder(
    session: &mut LibrarySession,
    folder_id: &str,
    asset_ids: &[String],
) -> LibrResult<usize> {
    if session.read_only {
        return Err(LibrError::ReadOnly);
    }
    let transaction = session.conn.transaction()?;
    let folder_exists = transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM folders WHERE id = ?1)",
        [folder_id],
        |row| row.get::<_, bool>(0),
    )?;
    if !folder_exists {
        return Err(LibrError::Other("目标文件夹不存在".into()));
    }

    let mut assigned = 0;
    for asset_id in asset_ids {
        assigned += transaction.execute(
            "INSERT OR IGNORE INTO asset_folders(asset_id, folder_id)
             SELECT id, ?2 FROM assets WHERE id = ?1 AND deleted_at IS NULL",
            params![asset_id, folder_id],
        )?;
    }
    if assigned > 0 {
        touch_library(&transaction)?;
    }
    transaction.commit()?;
    Ok(assigned)
}

pub fn create_folder(
    session: &mut LibrarySession,
    name: &str,
    parent_id: Option<&str>,
) -> LibrResult<Folder> {
    if session.read_only {
        return Err(LibrError::ReadOnly);
    }
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let sort_order: i64 = session.conn.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM folders WHERE parent_id IS ?1",
        [parent_id],
        |row| row.get(0),
    )?;
    session.conn.execute("INSERT INTO folders(id, parent_id, name, sort_order, created_at) VALUES (?1, ?2, ?3, ?4, ?5)", params![id, parent_id, name.trim(), sort_order, now])?;
    Ok(Folder {
        id,
        parent_id: parent_id.map(str::to_owned),
        name: name.trim().to_owned(),
        item_count: 0,
        sort_order,
        is_encrypted: false,
        is_locked: false,
        lock_owner_id: None,
    })
}

pub fn update_folder(
    session: &mut LibrarySession,
    id: &str,
    name: &str,
    parent_id: Option<&str>,
) -> LibrResult<Folder> {
    if session.read_only {
        return Err(LibrError::ReadOnly);
    }
    if parent_id == Some(id) {
        return Err(LibrError::Other("文件夹不能成为自己的子文件夹".into()));
    }
    session.conn.execute(
        "UPDATE folders SET name = ?1, parent_id = ?2 WHERE id = ?3",
        params![name.trim(), parent_id, id],
    )?;
    list_folders(session)?
        .into_iter()
        .find(|folder| folder.id == id)
        .ok_or_else(|| LibrError::Other("文件夹不存在".into()))
}

pub fn delete_folder(session: &mut LibrarySession, id: &str) -> LibrResult<()> {
    if session.read_only {
        return Err(LibrError::ReadOnly);
    }
    let transaction = session.conn.transaction()?;
    let parent_id: Option<String> = transaction
        .query_row("SELECT parent_id FROM folders WHERE id = ?1", [id], |row| {
            row.get(0)
        })
        .optional()?
        .flatten();
    transaction.execute(
        "UPDATE folders SET parent_id = ?1 WHERE parent_id = ?2",
        params![parent_id, id],
    )?;
    transaction.execute("DELETE FROM folders WHERE id = ?1", [id])?;
    touch_library(&transaction)?;
    transaction.commit()?;
    Ok(())
}

pub fn list_tags(session: &LibrarySession) -> LibrResult<Vec<Tag>> {
    let mut statement = session
        .conn
        .prepare("SELECT id, name, color FROM tags ORDER BY name COLLATE NOCASE")?;
    let tags = statement
        .query_map([], |row| {
            Ok(Tag {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(tags)
}

pub fn create_tag(
    session: &mut LibrarySession,
    name: &str,
    color: Option<&str>,
) -> LibrResult<Tag> {
    if session.read_only {
        return Err(LibrError::ReadOnly);
    }
    let id = Uuid::new_v4().to_string();
    session.conn.execute(
        "INSERT INTO tags(id, name, color, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![id, name.trim(), color, Utc::now().to_rfc3339()],
    )?;
    Ok(Tag {
        id,
        name: name.trim().to_owned(),
        color: color.map(str::to_owned),
    })
}

pub fn delete_tag(session: &mut LibrarySession, id: &str) -> LibrResult<()> {
    if session.read_only {
        return Err(LibrError::ReadOnly);
    }
    let transaction = session.conn.transaction()?;
    let asset_ids = transaction
        .prepare("SELECT asset_id FROM asset_tags WHERE tag_id = ?1")?
        .query_map([id], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    transaction.execute("DELETE FROM tags WHERE id = ?1", [id])?;
    for asset_id in asset_ids {
        refresh_search_row(&transaction, &asset_id)?;
    }
    touch_library(&transaction)?;
    transaction.commit()?;
    Ok(())
}

pub fn list_smart_folders(session: &LibrarySession) -> LibrResult<Vec<SmartFolder>> {
    let mut statement = session.conn.prepare(
        "SELECT id, name, query_json FROM smart_folders ORDER BY sort_order, name COLLATE NOCASE",
    )?;
    let folders = statement
        .query_map([], |row| {
            let query_json: String = row.get(2)?;
            Ok(SmartFolder {
                id: row.get(0)?,
                name: row.get(1)?,
                query: serde_json::from_str(&query_json)
                    .unwrap_or(serde_json::json!({"version": 1, "operator": "and", "rules": []})),
                item_count: 0,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(folders)
}

pub fn upsert_smart_folder(
    session: &mut LibrarySession,
    id: Option<&str>,
    name: &str,
    query: &serde_json::Value,
) -> LibrResult<SmartFolder> {
    if session.read_only {
        return Err(LibrError::ReadOnly);
    }
    if query.get("version").and_then(serde_json::Value::as_i64) != Some(1) {
        return Err(LibrError::Other("不支持的智能文件夹查询版本".into()));
    }
    let id = id
        .map(str::to_owned)
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let query_json = serde_json::to_string(query)?;
    let sort_order: i64 = session.conn.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM smart_folders",
        [],
        |row| row.get(0),
    )?;
    session.conn.execute(
        "INSERT INTO smart_folders(id, name, query_json, sort_order, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, query_json = excluded.query_json",
        params![id, name.trim(), query_json, sort_order, Utc::now().to_rfc3339()],
    )?;
    touch_library(&session.conn)?;
    Ok(SmartFolder {
        id,
        name: name.trim().to_owned(),
        query: query.clone(),
        item_count: 0,
    })
}

pub fn delete_smart_folder(session: &mut LibrarySession, id: &str) -> LibrResult<()> {
    if session.read_only {
        return Err(LibrError::ReadOnly);
    }
    session
        .conn
        .execute("DELETE FROM smart_folders WHERE id = ?1", [id])?;
    touch_library(&session.conn)?;
    Ok(())
}

pub fn stream_asset_to_writer(
    session: &LibrarySession,
    asset_id: &str,
    mut writer: impl Write,
) -> LibrResult<String> {
    let (rowid, filename): (i64, String) = session.conn.query_row(
        "SELECT b.rowid, a.display_name FROM assets a JOIN blobs b ON b.id = a.blob_id WHERE a.id = ?1",
        [asset_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    ).optional()?.ok_or(LibrError::AssetNotFound)?;
    let mut blob = session
        .conn
        .blob_open("main", "blobs", "data", rowid, true)?;
    std::io::copy(&mut blob, &mut writer)?;
    Ok(filename)
}

pub fn stream_asset_preview_to_writer(
    session: &LibrarySession,
    asset_id: &str,
    mut writer: impl Write,
) -> LibrResult<bool> {
    let preview: Option<Vec<u8>> = session
        .conn
        .query_row(
            "SELECT data FROM previews WHERE asset_id = ?1 AND kind = 'thumbnail'",
            [asset_id],
            |row| row.get(0),
        )
        .optional()?;
    let Some(preview) = preview else {
        return Ok(false);
    };
    writer.write_all(&preview)?;
    Ok(true)
}

pub fn export_assets(
    session: &LibrarySession,
    asset_ids: &[String],
    destination: &Path,
) -> LibrResult<()> {
    fs::create_dir_all(destination)?;
    for asset_id in asset_ids {
        let filename: String = session.conn.query_row(
            "SELECT display_name FROM assets WHERE id = ?1",
            [asset_id],
            |row| row.get(0),
        )?;
        let safe_name = sanitize_filename(&filename);
        let mut target = File::create(destination.join(safe_name))?;
        stream_asset_to_writer(session, asset_id, &mut target)?;
    }
    Ok(())
}

pub fn protocol_blob(
    session: &LibrarySession,
    asset_id: &str,
    preview: bool,
    start: u64,
    length: usize,
) -> LibrResult<(Vec<u8>, String, u64)> {
    if preview {
        let (data, mime): (Vec<u8>, String) = session
            .conn
            .query_row(
                "SELECT data, mime FROM previews WHERE asset_id = ?1 AND kind = 'thumbnail'",
                [asset_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?
            .ok_or(LibrError::AssetNotFound)?;
        let total = data.len() as u64;
        let from = usize::try_from(start.min(total)).unwrap_or(0);
        let to = (from + length).min(data.len());
        return Ok((data[from..to].to_vec(), mime, total));
    }
    let (rowid, mime, total): (i64, String, i64) = session.conn.query_row(
        "SELECT b.rowid, a.mime, b.byte_size FROM assets a JOIN blobs b ON b.id = a.blob_id WHERE a.id = ?1",
        [asset_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    ).optional()?.ok_or(LibrError::AssetNotFound)?;
    let blob = session
        .conn
        .blob_open("main", "blobs", "data", rowid, true)?;
    let available = (total.max(0) as u64).saturating_sub(start);
    let read_length = usize::try_from(available.min(length as u64)).unwrap_or(0);
    let mut buffer = vec![0u8; read_length];
    blob.read_at_exact(&mut buffer, start as usize)?;
    Ok((buffer, mime, total as u64))
}

pub fn protocol_metadata(
    session: &LibrarySession,
    asset_id: &str,
    preview: bool,
) -> LibrResult<(String, u64)> {
    if preview {
        return session.conn.query_row(
            "SELECT mime, length(data) FROM previews WHERE asset_id = ?1 AND kind = 'thumbnail'",
            [asset_id],
            |row| Ok((row.get(0)?, row.get::<_, i64>(1)? as u64)),
        ).optional()?.ok_or(LibrError::AssetNotFound);
    }
    session.conn.query_row(
        "SELECT a.mime, b.byte_size FROM assets a JOIN blobs b ON b.id = a.blob_id WHERE a.id = ?1",
        [asset_id],
        |row| Ok((row.get(0)?, row.get::<_, i64>(1)? as u64)),
    ).optional()?.ok_or(LibrError::AssetNotFound)
}

fn hash_file(path: &Path) -> LibrResult<String> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1024 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hex::encode(hasher.finalize()))
}

fn generate_image_preview(path: &Path) -> LibrResult<(Vec<u8>, u32, u32, String)> {
    let image = image::open(path)?;
    let width = image.width();
    let height = image.height();
    let color_pixel = image
        .resize_exact(1, 1, FilterType::Triangle)
        .to_rgb8()
        .get_pixel(0, 0)
        .0;
    let dominant_color = format!(
        "#{:02x}{:02x}{:02x}",
        color_pixel[0], color_pixel[1], color_pixel[2]
    );
    let thumbnail = image.thumbnail(720, 720).to_rgb8();
    let mut bytes = Cursor::new(Vec::new());
    image::DynamicImage::ImageRgb8(thumbnail).write_to(&mut bytes, image::ImageFormat::Jpeg)?;
    Ok((bytes.into_inner(), width, height, dominant_color))
}

fn classify_asset(extension: &str, mime: &str) -> AssetKind {
    match extension {
        "JPG" | "JPEG" | "PNG" | "GIF" | "WEBP" | "BMP" | "TIFF" | "TIF" | "SVG" | "ICO"
        | "HEIC" | "HEIF" => AssetKind::Image,
        "MP4" | "MOV" | "M4V" | "WEBM" => AssetKind::Video,
        "MP3" | "WAV" | "M4A" | "AAC" | "FLAC" | "OGG" => AssetKind::Audio,
        "PDF" => AssetKind::Pdf,
        "TTF" | "OTF" | "WOFF" | "WOFF2" => AssetKind::Font,
        "ZIP" | "RAR" | "7Z" | "TAR" | "GZ" => AssetKind::Archive,
        "TXT" | "MD" | "JSON" | "CSV" | "JS" | "TS" | "CSS" | "HTML" | "DOC" | "DOCX" | "XLS"
        | "XLSX" | "PPT" | "PPTX" | "PSD" | "AI" | "SKETCH" => AssetKind::Document,
        _ if mime.starts_with("image/") => AssetKind::Image,
        _ if mime.starts_with("video/") => AssetKind::Video,
        _ if mime.starts_with("audio/") => AssetKind::Audio,
        _ if mime.starts_with("text/") => AssetKind::Document,
        _ => AssetKind::Other,
    }
}

fn touch_library(conn: &Connection) -> LibrResult<()> {
    conn.execute(
        "UPDATE library_meta SET value = ?1 WHERE key = 'updated_at'",
        [Utc::now().to_rfc3339()],
    )?;
    Ok(())
}

fn refresh_search_row(conn: &Connection, asset_id: &str) -> LibrResult<()> {
    conn.execute("DELETE FROM asset_search WHERE asset_id = ?1", [asset_id])?;
    conn.execute(
        "INSERT INTO asset_search(asset_id, display_name, notes, source_path, tags)
         SELECT a.id, a.display_name, a.notes, a.source_path,
                COALESCE((SELECT GROUP_CONCAT(t.name, ' ') FROM tags t JOIN asset_tags at ON at.tag_id = t.id WHERE at.asset_id = a.id), '')
         FROM assets a WHERE a.id = ?1",
        [asset_id],
    )?;
    Ok(())
}

fn escape_like(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

pub(crate) fn sanitize_filename(value: &str) -> String {
    let sanitized = value
        .chars()
        .map(|character| match character {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            control if control.is_control() => '_',
            other => other,
        })
        .collect::<String>();
    if sanitized.trim().is_empty() {
        "未命名文件".to_owned()
    } else {
        sanitized
    }
}

fn system_time_to_rfc3339(time: SystemTime) -> String {
    DateTime::<Utc>::from(time).to_rfc3339()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn creates_single_file_library_with_expected_identity() {
        let temp = tempdir().unwrap();
        let path = temp.path().join("测试资源库.libr");
        let session = create_library(&path, "测试资源库").unwrap();
        let info = library_info(&session).unwrap();
        assert_eq!(info.name, "测试资源库");
        assert_eq!(info.schema_version, SCHEMA_VERSION);
        assert!(path.is_file());
    }

    #[test]
    fn duplicate_import_reuses_blob() {
        let temp = tempdir().unwrap();
        let path = temp.path().join("test.libr");
        let source = temp.path().join("你好.txt");
        fs::write(&source, "same bytes").unwrap();
        let mut session = create_library(&path, "test").unwrap();
        let first = import_file(&mut session, &source, None).unwrap();
        let second = import_file(&mut session, &source, None).unwrap();
        assert!(!first.duplicate);
        assert!(second.duplicate);
        let blob_count: i64 = session
            .conn
            .query_row("SELECT COUNT(*) FROM blobs", [], |row| row.get(0))
            .unwrap();
        assert_eq!(blob_count, 1);
    }

    #[test]
    fn sidebar_counts_and_folder_assignment_follow_library_state() {
        let temp = tempdir().unwrap();
        let path = temp.path().join("counts.libr");
        let source = temp.path().join("asset.txt");
        fs::write(&source, "shared bytes").unwrap();
        let mut session = create_library(&path, "counts").unwrap();
        let first = import_file(&mut session, &source, None).unwrap().asset;
        update_asset(
            &mut session,
            &first.id,
            &AssetPatch {
                favorite: Some(true),
                ..AssetPatch::default()
            },
        )
        .unwrap();
        let second_id = Uuid::new_v4().to_string();
        session.conn.execute(
            "INSERT INTO assets(id, blob_id, display_name, extension, kind, mime, byte_size, notes, source_path, imported_at, created_at)
             SELECT ?1, blob_id, 'second.txt', extension, kind, mime, byte_size, '', source_path, imported_at, created_at FROM assets WHERE id = ?2",
            params![second_id, first.id],
        ).unwrap();

        let before = library_info(&session).unwrap();
        assert_eq!(before.asset_count, 2);
        assert_eq!(before.recent_count, 2);
        assert_eq!(before.unfiled_count, 2);
        assert_eq!(before.favorite_count, 1);
        assert_eq!(before.duplicate_count, 2);

        let folder = create_folder(&mut session, "整理", None).unwrap();
        assert_eq!(
            assign_assets_to_folder(&mut session, &folder.id, &[first.id.clone()]).unwrap(),
            1
        );
        assert_eq!(
            assign_assets_to_folder(&mut session, &folder.id, &[first.id.clone()]).unwrap(),
            0
        );
        assert_eq!(list_folders(&session).unwrap()[0].item_count, 1);
        assert_eq!(library_info(&session).unwrap().unfiled_count, 1);

        set_assets_deleted(&mut session, &[second_id], true).unwrap();
        let after = library_info(&session).unwrap();
        assert_eq!(after.asset_count, 1);
        assert_eq!(after.trash_count, 1);
    }

    #[test]
    fn folder_passwords_lock_descendants_and_can_be_removed() {
        let temp = tempdir().unwrap();
        let path = temp.path().join("protected.libr");
        let mut session = create_library(&path, "protected").unwrap();
        let parent = create_folder(&mut session, "私密", None).unwrap();
        let child = create_folder(&mut session, "子文件夹", Some(&parent.id)).unwrap();
        let source = temp.path().join("secret.txt");
        fs::write(&source, "private content").unwrap();
        let asset = import_file(&mut session, &source, Some(&child.id))
            .unwrap()
            .asset;

        set_folder_password(&mut session, &parent.id, "12345678").unwrap();
        assert!(!verify_folder_password(&session, &parent.id, "87654321").unwrap());
        assert!(verify_folder_password(&session, &parent.id, "12345678").unwrap());

        let locked = folder_lock_owners(&session, &HashSet::new()).unwrap();
        assert_eq!(locked.get(&parent.id), Some(&parent.id));
        assert_eq!(locked.get(&child.id), Some(&parent.id));
        let blocked_ids = locked.into_keys().collect();
        assert!(
            list_assets_with_blocked_folders(&session, &SearchQuery::default(), &blocked_ids)
                .unwrap()
                .is_empty()
        );
        assert!(ensure_assets_accessible(&session, &[asset.id], &blocked_ids).is_err());

        let unlocked = HashSet::from([parent.id.clone()]);
        assert!(folder_lock_owners(&session, &unlocked).unwrap().is_empty());
        assert!(!clear_folder_password(&mut session, &parent.id, "87654321").unwrap());
        assert!(clear_folder_password(&mut session, &parent.id, "12345678").unwrap());
        assert!(!list_folders(&session).unwrap()[0].is_encrypted);
    }

    #[test]
    fn opening_a_v1_library_migrates_folder_password_storage() {
        let temp = tempdir().unwrap();
        let path = temp.path().join("legacy.libr");
        drop(create_library(&path, "legacy").unwrap());
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "ALTER TABLE folders DROP COLUMN password_hash; PRAGMA user_version = 1;",
        )
        .unwrap();
        drop(conn);

        let mut session = open_library(&path).unwrap();
        assert_eq!(
            session
                .conn
                .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
                .unwrap(),
            SCHEMA_VERSION
        );
        create_folder(&mut session, "可加密", None).unwrap();
    }

    #[test]
    fn filename_sanitization_is_cross_platform_safe() {
        assert_eq!(sanitize_filename("a:b/c?.png"), "a_b_c_.png");
    }

    #[test]
    fn search_and_filters_cover_unicode_metadata() {
        let temp = tempdir().unwrap();
        let path = temp.path().join("search.libr");
        let source = temp.path().join("品牌素材说明.txt");
        fs::write(&source, "hello").unwrap();
        let mut session = create_library(&path, "search").unwrap();
        let imported = import_file(&mut session, &source, None).unwrap().asset;
        update_asset(
            &mut session,
            &imported.id,
            &AssetPatch {
                notes: Some("中文特殊备注".into()),
                rating: Some(4),
                ..AssetPatch::default()
            },
        )
        .unwrap();
        let matches = list_assets(
            &session,
            &SearchQuery {
                text: Some("特殊备注".into()),
                min_rating: Some(4),
                min_byte_size: Some(5),
                ..SearchQuery::default()
            },
        )
        .unwrap();
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].id, imported.id);
    }

    #[test]
    fn purge_only_removes_unreferenced_blob() {
        let temp = tempdir().unwrap();
        let path = temp.path().join("trash.libr");
        let source = temp.path().join("shared.txt");
        fs::write(&source, "shared bytes").unwrap();
        let mut session = create_library(&path, "trash").unwrap();
        let first = import_file(&mut session, &source, None).unwrap().asset;
        let second_id = Uuid::new_v4().to_string();
        session.conn.execute(
            "INSERT INTO assets(id, blob_id, display_name, extension, kind, mime, byte_size, notes, source_path, imported_at, created_at)
             SELECT ?1, blob_id, 'second.txt', extension, kind, mime, byte_size, '', source_path, imported_at, created_at FROM assets WHERE id = ?2",
            params![second_id, first.id],
        ).unwrap();
        set_assets_deleted(&mut session, &[first.id.clone()], true).unwrap();
        purge_assets(&mut session, &[first.id]).unwrap();
        let blob_count: i64 = session
            .conn
            .query_row("SELECT COUNT(*) FROM blobs", [], |row| row.get(0))
            .unwrap();
        let asset_count: i64 = session
            .conn
            .query_row(
                "SELECT COUNT(*) FROM assets WHERE id = ?1",
                [second_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(blob_count, 1);
        assert_eq!(asset_count, 1);
    }

    #[test]
    fn newer_schema_opens_read_only() {
        let temp = tempdir().unwrap();
        let path = temp.path().join("future.libr");
        drop(create_library(&path, "future").unwrap());
        let conn = Connection::open(&path).unwrap();
        conn.pragma_update(None, "user_version", SCHEMA_VERSION + 1)
            .unwrap();
        drop(conn);
        let session = open_library(&path).unwrap();
        assert!(session.read_only);
    }

    #[test]
    fn smart_folder_queries_are_versioned() {
        let temp = tempdir().unwrap();
        let path = temp.path().join("smart.libr");
        let mut session = create_library(&path, "smart").unwrap();
        let query = serde_json::json!({"version": 1, "operator": "and", "rules": [{"field": "rating", "operator": "gte", "value": 4}]});
        let folder = upsert_smart_folder(&mut session, None, "高评分", &query).unwrap();
        assert_eq!(folder.query["version"], 1);
        assert!(upsert_smart_folder(
            &mut session,
            None,
            "future",
            &serde_json::json!({"version": 2})
        )
        .is_err());
    }
}
