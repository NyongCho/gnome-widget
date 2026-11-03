//! Private, bounded cache files. Replacement is atomic; temporary files are never published.
use crate::{types::ProviderName, validation::MAX_PAYLOAD_BYTES};
use std::{
    fs::{self, DirBuilder, File, OpenOptions},
    io::{self, Read, Write},
    os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
};
const LIMIT: usize = MAX_PAYLOAD_BYTES + 4096;
#[derive(Clone)]
pub struct CacheKey(String);
impl CacheKey {
    pub fn new(name: ProviderName, source: &str) -> io::Result<Self> {
        if source.is_empty()
            || source.len() > 128
            || !source
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        {
            return Err(io::Error::other("invalid cache identity"));
        }
        Ok(Self(format!("{}-{source}.json", name.as_str())))
    }
    fn calendar_raw(source: &str) -> io::Result<Self> {
        let mut key = Self::new(ProviderName::Calendar, source)?;
        key.0 = key.0.replace(".json", ".ics");
        Ok(key)
    }
    pub fn settings() -> Self {
        Self("settings.toml".into())
    }
}
#[derive(Clone)]
pub struct PrivateStore(PathBuf);
impl PrivateStore {
    pub fn new(root: &Path) -> io::Result<Self> {
        if let Ok(meta) = fs::symlink_metadata(root)
            && (!meta.is_dir() || meta.file_type().is_symlink())
        {
            return Err(io::Error::other("invalid private directory"));
        }
        DirBuilder::new().recursive(true).mode(0o700).create(root)?;
        fs::set_permissions(root, fs::Permissions::from_mode(0o700))?;
        Ok(Self(root.into()))
    }
    pub fn path(&self, key: &CacheKey) -> PathBuf {
        self.0.join(&key.0)
    }
    pub fn write(&self, key: &CacheKey, bytes: &[u8]) -> io::Result<()> {
        self.write_limit(key, bytes, LIMIT)
    }
    fn write_limit(&self, key: &CacheKey, bytes: &[u8], limit: usize) -> io::Result<()> {
        if bytes.len() > limit {
            return Err(io::Error::other("cache too large"));
        }
        let temp = self.0.join(format!(".{}.tmp", uuid::Uuid::new_v4()));
        let result = (|| {
            let mut f = OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .custom_flags(libc::O_NOFOLLOW)
                .open(&temp)?;
            f.write_all(bytes)?;
            f.sync_all()?;
            fs::rename(&temp, self.path(key))?;
            File::open(&self.0)?.sync_all()
        })();
        if result.is_err() {
            let _ = fs::remove_file(temp);
        }
        result
    }
    pub fn read(&self, key: &CacheKey) -> io::Result<Option<Vec<u8>>> {
        self.read_limit(key, LIMIT)
    }
    fn read_limit(&self, key: &CacheKey, limit: usize) -> io::Result<Option<Vec<u8>>> {
        let file = match OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
            .open(self.path(key))
        {
            Ok(f) => f,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(e),
        };
        let meta = file.metadata()?;
        if !meta.is_file() || meta.permissions().mode() & 0o077 != 0 {
            return Err(io::Error::other("insecure cache file"));
        }
        let mut bytes = Vec::new();
        file.take(limit as u64 + 1).read_to_end(&mut bytes)?;
        if bytes.len() > limit {
            return Err(io::Error::other("cache too large"));
        }
        Ok(Some(bytes))
    }
    pub fn read_calendar(
        &self,
        source: &str,
    ) -> io::Result<Option<crate::providers::calendar_feed::CalendarCache>> {
        let Some(bytes) = self.read_limit(
            &CacheKey::calendar_raw(source)?,
            crate::providers::calendar::MAX_ICS_BYTES + 128,
        )?
        else {
            return Ok(None);
        };
        let text =
            String::from_utf8(bytes).map_err(|_| io::Error::other("invalid calendar cache"))?;
        let (fetched_at, ics) = text
            .split_once('\n')
            .ok_or_else(|| io::Error::other("invalid calendar cache"))?;
        chrono::DateTime::parse_from_rfc3339(fetched_at)
            .map_err(|_| io::Error::other("invalid cache timestamp"))?;
        if ics.len() > crate::providers::calendar::MAX_ICS_BYTES {
            return Err(io::Error::other("cache too large"));
        }
        Ok(Some(crate::providers::calendar_feed::CalendarCache {
            fetched_at: fetched_at.into(),
            ics: ics.into(),
        }))
    }
    pub fn write_calendar(
        &self,
        source: &str,
        cached: &crate::providers::calendar_feed::CalendarCache,
    ) -> io::Result<()> {
        chrono::DateTime::parse_from_rfc3339(&cached.fetched_at)
            .map_err(|_| io::Error::other("invalid cache timestamp"))?;
        if cached.ics.len() > crate::providers::calendar::MAX_ICS_BYTES {
            return Err(io::Error::other("cache too large"));
        }
        self.write_limit(
            &CacheKey::calendar_raw(source)?,
            format!("{}\n{}", cached.fetched_at, cached.ics).as_bytes(),
            crate::providers::calendar::MAX_ICS_BYTES + 128,
        )
    }
    pub fn remove_provider(&self, provider: ProviderName) -> io::Result<()> {
        let prefix = format!("{}-", provider.as_str());
        for entry in fs::read_dir(&self.0)? {
            let entry = entry?;
            if entry
                .file_name()
                .to_str()
                .is_some_and(|name| name.starts_with(&prefix))
            {
                fs::remove_file(entry.path())?;
            }
        }
        File::open(&self.0)?.sync_all()
    }
    pub fn remove(&self, key: &CacheKey) -> io::Result<()> {
        match fs::remove_file(self.path(key)) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e),
        }
    }
}
