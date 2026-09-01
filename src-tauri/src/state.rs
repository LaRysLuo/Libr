use std::{
    collections::{HashMap, HashSet},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};

use parking_lot::Mutex;

use crate::{db::LibrarySession, models::LanShareInfo};

pub struct LanShareRuntime {
    pub stop: Arc<AtomicBool>,
    pub info: LanShareInfo,
}

#[derive(Clone, Default)]
pub struct AppState {
    pub session: Arc<Mutex<Option<LibrarySession>>>,
    pub cancelled_jobs: Arc<Mutex<HashSet<String>>>,
    pub stream_tokens: Arc<Mutex<StreamTokenStore>>,
    pub unlocked_folders: Arc<Mutex<HashSet<String>>>,
    pub lan_share: Arc<Mutex<Option<LanShareRuntime>>>,
}

impl AppState {
    pub fn stop_lan_share(&self) -> Option<LanShareInfo> {
        let runtime = self.lan_share.lock().take()?;
        runtime.stop.store(true, Ordering::Release);
        Some(runtime.info)
    }
}

#[derive(Default)]
pub struct StreamTokenStore {
    by_token: HashMap<String, String>,
    by_asset: HashMap<String, String>,
}

impl StreamTokenStore {
    pub fn token_for(&mut self, asset_id: &str) -> String {
        if let Some(token) = self.by_asset.get(asset_id) {
            return token.clone();
        }
        let token = uuid::Uuid::new_v4().simple().to_string();
        self.by_token.insert(token.clone(), asset_id.to_owned());
        self.by_asset.insert(asset_id.to_owned(), token.clone());
        token
    }

    pub fn resolve(&self, token: &str) -> Option<String> {
        self.by_token.get(token).cloned()
    }

    pub fn clear(&mut self) {
        self.by_token.clear();
        self.by_asset.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stream_tokens_are_opaque_stable_and_revocable() {
        let mut store = StreamTokenStore::default();
        let token = store.token_for("asset-id");
        assert_ne!(token, "asset-id");
        assert_eq!(store.token_for("asset-id"), token);
        assert_eq!(store.resolve(&token).as_deref(), Some("asset-id"));
        store.clear();
        assert!(store.resolve(&token).is_none());
    }
}
