use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryInfo {
    pub id: String,
    pub name: String,
    pub path: String,
    pub schema_version: i64,
    pub read_only: bool,
    pub asset_count: i64,
    pub recent_count: i64,
    pub unfiled_count: i64,
    pub favorite_count: i64,
    pub duplicate_count: i64,
    pub trash_count: i64,
    pub total_bytes: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AssetKind {
    Image,
    Video,
    Audio,
    Pdf,
    Document,
    Font,
    Archive,
    Other,
}

impl AssetKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Image => "image",
            Self::Video => "video",
            Self::Audio => "audio",
            Self::Pdf => "pdf",
            Self::Document => "document",
            Self::Font => "font",
            Self::Archive => "archive",
            Self::Other => "other",
        }
    }

    pub fn from_db(value: &str) -> Self {
        match value {
            "image" => Self::Image,
            "video" => Self::Video,
            "audio" => Self::Audio,
            "pdf" => Self::Pdf,
            "document" => Self::Document,
            "font" => Self::Font,
            "archive" => Self::Archive,
            _ => Self::Other,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Asset {
    pub id: String,
    pub display_name: String,
    pub extension: String,
    pub kind: AssetKind,
    pub mime: String,
    pub byte_size: i64,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub duration_ms: Option<i64>,
    pub rating: i64,
    pub favorite: bool,
    pub color_label: Option<String>,
    pub dominant_color: Option<String>,
    pub notes: String,
    pub source_path: String,
    pub imported_at: String,
    pub created_at: String,
    pub deleted_at: Option<String>,
    pub folder_ids: Vec<String>,
    pub tags: Vec<Tag>,
    pub preview_url: Option<String>,
    pub asset_url: Option<String>,
    pub stream_token: Option<String>,
    pub duplicate_count: i64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetPatch {
    pub display_name: Option<String>,
    pub rating: Option<i64>,
    pub favorite: Option<bool>,
    pub color_label: Option<Option<String>>,
    pub clear_color_label: Option<bool>,
    pub notes: Option<String>,
    pub tag_ids: Option<Vec<String>>,
    pub folder_ids: Option<Vec<String>>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchQuery {
    pub text: Option<String>,
    pub folder_id: Option<String>,
    pub kinds: Option<Vec<AssetKind>>,
    pub tag_ids: Option<Vec<String>>,
    pub favorite: Option<bool>,
    pub min_rating: Option<i64>,
    pub color_label: Option<String>,
    pub unfiled: Option<bool>,
    pub untagged: Option<bool>,
    pub duplicates: Option<bool>,
    pub min_byte_size: Option<i64>,
    pub max_byte_size: Option<i64>,
    pub imported_after: Option<String>,
    pub imported_before: Option<String>,
    pub aspect_ratio: Option<String>,
    pub deleted: Option<bool>,
    pub sort_by: Option<String>,
    pub sort_direction: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub id: String,
    pub parent_id: Option<String>,
    pub name: String,
    pub item_count: i64,
    pub sort_order: i64,
    pub is_encrypted: bool,
    pub is_locked: bool,
    pub lock_owner_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartFolder {
    pub id: String,
    pub name: String,
    pub query: serde_json::Value,
    pub item_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FailedImport {
    pub path: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub job_id: String,
    pub imported: Vec<Asset>,
    pub duplicates: usize,
    pub failed: Vec<FailedImport>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobProgress {
    pub job_id: String,
    pub kind: String,
    pub completed: usize,
    pub total: usize,
    pub current_item: Option<String>,
    pub phase: String,
    pub message: Option<String>,
}
