use std::{
    fs,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};

use crate::error::LibrResult;

const PREFERENCES_FILE: &str = "preferences.json";

#[derive(Debug, Default, Deserialize, Serialize)]
struct Preferences {
    last_library_path: Option<PathBuf>,
}

fn preferences_path(config_dir: &Path) -> PathBuf {
    config_dir.join(PREFERENCES_FILE)
}

pub fn last_library_path(config_dir: &Path) -> Option<PathBuf> {
    let contents = fs::read(preferences_path(config_dir)).ok()?;
    serde_json::from_slice::<Preferences>(&contents)
        .ok()?
        .last_library_path
}

pub fn remember_library(config_dir: &Path, library_path: &Path) -> LibrResult<()> {
    fs::create_dir_all(config_dir)?;
    let path = library_path
        .canonicalize()
        .unwrap_or_else(|_| library_path.to_path_buf());
    let contents = serde_json::to_vec_pretty(&Preferences {
        last_library_path: Some(path),
    })?;
    fs::write(preferences_path(config_dir), contents)?;
    Ok(())
}

pub fn forget_library(config_dir: &Path) -> LibrResult<()> {
    let path = preferences_path(config_dir);
    if path.exists() {
        fs::remove_file(path)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remembers_and_forgets_the_last_library() {
        let root = tempfile::tempdir().unwrap();
        let library = root.path().join("我的素材.libr");
        fs::write(&library, b"library").unwrap();
        let config = root.path().join("config");

        remember_library(&config, &library).unwrap();
        let canonical_library = library.canonicalize().unwrap();
        assert_eq!(
            last_library_path(&config).as_deref(),
            Some(canonical_library.as_path())
        );

        forget_library(&config).unwrap();
        assert_eq!(last_library_path(&config), None);
    }

    #[test]
    fn treats_invalid_preferences_as_empty() {
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join(PREFERENCES_FILE), b"not json").unwrap();
        assert_eq!(last_library_path(root.path()), None);
    }
}
