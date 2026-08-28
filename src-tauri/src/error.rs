use thiserror::Error;

#[derive(Debug, Error)]
pub enum LibrError {
    #[error("资源库尚未打开")]
    NoLibrary,
    #[error("资源库是只读的")]
    ReadOnly,
    #[error("不是有效的 Libr 资源库")]
    InvalidLibrary,
    #[error("资源不存在")]
    AssetNotFound,
    #[error("操作已取消")]
    Cancelled,
    #[error("数据库错误：{0}")]
    Database(#[from] rusqlite::Error),
    #[error("文件系统错误：{0}")]
    Io(#[from] std::io::Error),
    #[error("图像处理错误：{0}")]
    Image(#[from] image::ImageError),
    #[error("序列化错误：{0}")]
    Serialization(#[from] serde_json::Error),
    #[error("{0}")]
    Other(String),
}

impl serde::Serialize for LibrError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type LibrResult<T> = Result<T, LibrError>;
