//! Download artwork in the daemon; only private local files cross the Shell boundary.
use crate::{
    cache::{CacheKey, PrivateStore},
    http::Fetcher,
    state::Failure,
    worker::BlockingWorker,
};
use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};

const MAX_BYTES: usize = 8 * 1024 * 1024;
const CACHE_BYTES: u64 = 64 * 1024 * 1024;
const CACHE_FILES: usize = 64;
const FETCH_TIMEOUT: Duration = Duration::from_secs(5);
const RETRY_DELAY: Duration = Duration::from_secs(2);
const FAILURE_COOLDOWN: Duration = Duration::from_secs(60);

pub struct Artwork {
    root: PathBuf,
    fetcher: Arc<dyn Fetcher>,
    disk: Arc<Mutex<()>>,
    fetching: tokio::sync::Mutex<()>,
    failures: Mutex<HashMap<String, tokio::time::Instant>>,
}

fn remote_url(uri: &str) -> Option<reqwest::Url> {
    if uri.len() > 4096 {
        return None;
    }
    let url = reqwest::Url::parse(uri).ok()?;
    (url.scheme() == "https"
        && url.host_str().is_some()
        && url.username().is_empty()
        && url.password().is_none()
        && url.fragment().is_none())
    .then_some(url)
}

fn cached(store: &PrivateStore, key: &CacheKey) -> Option<String> {
    let bytes = store.read_limit(key, MAX_BYTES).ok()??;
    if bytes.is_empty() {
        return None;
    }
    super::media::local_art(reqwest::Url::from_file_path(store.path(key)).ok()?.as_str())
}

// Reserve space before atomically publishing a new file. Old temporary files are
// crash remnants: disk operations are serialized, so none can still be in use.
fn reserve(root: &std::path::Path, incoming: usize) -> std::io::Result<()> {
    let mut entries = Vec::new();
    let mut total = 0;
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        let meta = fs::symlink_metadata(entry.path())?;
        if name.starts_with('.') && name.ends_with(".tmp") {
            fs::remove_file(entry.path())?;
        } else if name.ends_with(".art") {
            if !meta.is_file() || meta.len() > MAX_BYTES as u64 {
                fs::remove_file(entry.path())?;
                continue;
            }
            total += meta.len();
            entries.push((meta.modified()?, entry.path(), meta.len()));
        }
    }
    entries.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)));
    let mut remaining = entries.len();
    for (_, path, length) in entries {
        if remaining < CACHE_FILES && total + incoming as u64 <= CACHE_BYTES {
            break;
        }
        fs::remove_file(path)?;
        total -= length;
        remaining -= 1;
    }
    Ok(())
}

impl Artwork {
    pub fn new(root: PathBuf, fetcher: Arc<dyn Fetcher>) -> Self {
        Self {
            root,
            fetcher,
            disk: Arc::new(Mutex::new(())),
            fetching: tokio::sync::Mutex::new(()),
            failures: Mutex::new(HashMap::new()),
        }
    }

    pub async fn cached(&self, uri: &str, worker: &BlockingWorker) -> Option<String> {
        let remote = remote_url(uri);
        let uri = uri.to_owned();
        let root = self.root.clone();
        let disk = self.disk.clone();
        worker
            .run_when_available(move || {
                if let Some(url) = remote {
                    let _guard = disk.lock().ok()?;
                    let store = PrivateStore::new(&root).ok()?;
                    cached(&store, &CacheKey::artwork(url.as_str()))
                } else {
                    super::media::local_art(&uri)
                }
            })
            .await
            .ok()
            .flatten()
    }

    pub async fn fetch(&self, uri: &str, worker: &BlockingWorker) -> Option<String> {
        let url = remote_url(uri)?;
        // Canceling a collection drops this guard and the network future. A new
        // collector can immediately resolve the currently selected track.
        let _fetching = self.fetching.lock().await;
        if let Some(uri) = self.cached(uri, worker).await {
            return Some(uri);
        }
        if self
            .failures
            .lock()
            .ok()?
            .get(url.as_str())
            .is_some_and(|at| at.elapsed() < FAILURE_COOLDOWN)
        {
            return None;
        }
        let result = self.download(&url, worker).await;
        let mut failures = self.failures.lock().ok()?;
        failures.retain(|_, at| at.elapsed() < FAILURE_COOLDOWN);
        if result.is_none() {
            if failures.len() >= CACHE_FILES
                && let Some(oldest) = failures
                    .iter()
                    .min_by_key(|(_, at)| *at)
                    .map(|(key, _)| key.clone())
            {
                failures.remove(&oldest);
            }
            failures.insert(url.to_string(), tokio::time::Instant::now());
        }
        result
    }

    async fn download(&self, url: &reqwest::Url, worker: &BlockingWorker) -> Option<String> {
        let request = async || {
            tokio::time::timeout(FETCH_TIMEOUT, self.fetcher.get(url.clone(), MAX_BYTES))
                .await
                .unwrap_or(Err(Failure::Network))
        };
        let bytes = match request().await {
            Err(Failure::Network) => {
                tokio::time::sleep(RETRY_DELAY).await;
                request().await.ok()?
            }
            result => result.ok()?,
        };
        if bytes.is_empty() || bytes.len() > MAX_BYTES {
            return None;
        }
        let url = url.clone();
        let root = self.root.clone();
        let disk = self.disk.clone();
        worker
            .run_when_available(move || {
                let _guard = disk.lock().ok()?;
                let store = PrivateStore::new(&root).ok()?;
                let key = CacheKey::artwork(url.as_str());
                reserve(&root, bytes.len()).ok()?;
                store.write_limit(&key, &bytes, MAX_BYTES).ok()?;
                cached(&store, &key)
            })
            .await
            .ok()
            .flatten()
    }
}
