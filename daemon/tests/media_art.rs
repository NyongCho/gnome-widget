use liquid_widgets_daemon::{
    http::{FetchFuture, Fetcher, Http},
    providers::media_art::Artwork,
    state::Failure,
    worker::BlockingWorker,
};
use std::{
    collections::VecDeque,
    io::{Read, Write},
    net::TcpListener,
    os::unix::fs::PermissionsExt,
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};

const SOURCE: &str = "https://i.scdn.co/image/fixture";
struct Reply {
    results: Mutex<VecDeque<Result<Vec<u8>, Failure>>>,
    calls: AtomicUsize,
}
impl Reply {
    fn new(results: impl IntoIterator<Item = Result<Vec<u8>, Failure>>) -> Arc<Self> {
        Arc::new(Self {
            results: Mutex::new(results.into_iter().collect()),
            calls: AtomicUsize::new(0),
        })
    }
}
impl Fetcher for Reply {
    fn get(&self, _url: reqwest::Url, limit: usize) -> FetchFuture<'_> {
        assert_eq!(limit, 8 * 1024 * 1024);
        self.calls.fetch_add(1, Ordering::SeqCst);
        let result = self
            .results
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or(Err(Failure::Network));
        Box::pin(async { result })
    }
}
// Keeps the real HTTP streaming/limits while routing fixture HTTPS identities to
// a loopback HTTP server. Production Http remains HTTPS-only with no redirects.
struct FixtureHttp {
    http: Http,
    target: reqwest::Url,
    calls: AtomicUsize,
}
impl Fetcher for FixtureHttp {
    fn get(&self, _url: reqwest::Url, limit: usize) -> FetchFuture<'_> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.http.get(self.target.clone(), limit)
    }
}
fn serve(response: Vec<u8>, delay: Duration) -> reqwest::Url {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url =
        reqwest::Url::parse(&format!("http://{}/art", listener.local_addr().unwrap())).unwrap();
    std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(1)))
            .unwrap();
        let mut request = [0; 1024];
        let _ = stream.read(&mut request);
        std::thread::sleep(delay);
        let _ = stream.write_all(&response);
    });
    url
}
fn fixture_http(response: Vec<u8>, delay: Duration) -> Arc<FixtureHttp> {
    Arc::new(FixtureHttp {
        http: Http::with_client(
            reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(Duration::from_millis(100))
                .build()
                .unwrap(),
        ),
        target: serve(response, delay),
        calls: AtomicUsize::new(0),
    })
}
#[tokio::test]
async fn http_art_is_private_atomic_stable_and_reused_after_restart() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("artwork");
    let fetcher = fixture_http(
        b"HTTP/1.1 200 OK\r\nContent-Length: 11\r\nConnection: close\r\n\r\nfixture art".to_vec(),
        Duration::ZERO,
    );
    let art = Artwork::new(path.clone(), fetcher.clone());
    let worker = BlockingWorker::new(2);
    let uri = art.fetch(SOURCE, &worker).await.unwrap();
    let file = reqwest::Url::parse(&uri).unwrap().to_file_path().unwrap();
    assert_eq!(std::fs::read(&file).unwrap(), b"fixture art");
    assert_eq!(
        std::fs::metadata(&file).unwrap().permissions().mode() & 0o777,
        0o600
    );
    assert_eq!(
        std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
        0o700
    );
    assert_eq!(std::fs::read_dir(&path).unwrap().count(), 1);
    assert!(
        !file
            .file_name()
            .unwrap()
            .to_string_lossy()
            .contains("fixture")
    );
    assert_eq!(
        art.fetch(SOURCE, &worker).await.as_deref(),
        Some(uri.as_str())
    );
    let restarted = Artwork::new(path, fetcher.clone());
    assert_eq!(
        restarted.fetch(SOURCE, &worker).await.as_deref(),
        Some(uri.as_str())
    );
    assert_eq!(fetcher.calls.load(Ordering::SeqCst), 1);
}
#[tokio::test]
async fn invalid_remote_urls_and_readable_local_art_never_request_http() {
    let root = tempfile::tempdir().unwrap();
    let fetcher = Reply::new([]);
    let art = Artwork::new(root.path().join("artwork"), fetcher.clone());
    let worker = BlockingWorker::new(2);
    for uri in [
        "http://example.test/art",
        "data:image/png;base64,test",
        "https://user:secret@example.test/art",
        "https://example.test/art#fragment",
        "file://host/art",
        "",
    ] {
        assert!(art.fetch(uri, &worker).await.is_none());
    }
    assert!(
        art.fetch(
            &format!("https://example.test/{}", "x".repeat(4096)),
            &worker
        )
        .await
        .is_none()
    );
    let local = root.path().join("local");
    std::fs::write(&local, b"local art").unwrap();
    let uri = reqwest::Url::from_file_path(local).unwrap().to_string();
    assert_eq!(art.cached(&uri, &worker).await, Some(uri));
    assert_eq!(fetcher.calls.load(Ordering::SeqCst), 0);
}
#[tokio::test]
async fn empty_or_oversize_bytes_never_publish_a_cache_file() {
    let root = tempfile::tempdir().unwrap();
    let cache = root.path().join("artwork");
    let fetcher = Reply::new([Ok(Vec::new()), Ok(vec![0; 8 * 1024 * 1024 + 1])]);
    let art = Artwork::new(cache.clone(), fetcher);
    let worker = BlockingWorker::new(2);
    assert!(art.fetch(SOURCE, &worker).await.is_none());
    assert!(
        art.fetch("https://example.test/oversize", &worker)
            .await
            .is_none()
    );
    assert_eq!(std::fs::read_dir(cache).unwrap().count(), 0);
}
#[tokio::test]
async fn cache_is_bounded_by_count_and_bytes_and_cleans_interrupted_writes() {
    let root = tempfile::tempdir().unwrap();
    let cache = root.path().join("artwork");
    std::fs::create_dir(&cache).unwrap();
    std::fs::write(cache.join(".interrupted.tmp"), b"incomplete").unwrap();
    let fetcher = Reply::new((0..65).map(|_| Ok(vec![1])));
    let art = Artwork::new(cache.clone(), fetcher);
    let worker = BlockingWorker::new(2);
    for i in 0..65 {
        assert!(
            art.fetch(&format!("https://example.test/count-{i}"), &worker)
                .await
                .is_some()
        );
    }
    assert_eq!(std::fs::read_dir(&cache).unwrap().count(), 64);
    assert!(!cache.join(".interrupted.tmp").exists());
    let fetcher = Reply::new((0..9).map(|_| Ok(vec![1; 8 * 1024 * 1024])));
    let art = Artwork::new(cache.clone(), fetcher);
    for i in 0..9 {
        assert!(
            art.fetch(&format!("https://example.test/bytes-{i}"), &worker)
                .await
                .is_some()
        );
    }
    let total: u64 = std::fs::read_dir(cache)
        .unwrap()
        .map(|entry| entry.unwrap().metadata().unwrap().len())
        .sum();
    assert!(total <= 64 * 1024 * 1024);
}
#[tokio::test]
async fn cache_rejects_symlinks_public_files_and_fifos_without_blocking() {
    use std::os::unix::{ffi::OsStrExt, fs::symlink};
    let root = tempfile::tempdir().unwrap();
    let art = Artwork::new(root.path().join("artwork"), Reply::new([Ok(vec![1])]));
    let worker = BlockingWorker::new(2);
    let uri = art.fetch(SOURCE, &worker).await.unwrap();
    let path = reqwest::Url::parse(&uri).unwrap().to_file_path().unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
    assert!(art.cached(SOURCE, &worker).await.is_none());
    std::fs::remove_file(&path).unwrap();
    let target = root.path().join("outside");
    std::fs::write(&target, b"outside").unwrap();
    symlink(&target, &path).unwrap();
    assert!(art.cached(SOURCE, &worker).await.is_none());
    std::fs::remove_file(&path).unwrap();
    let cpath = std::ffi::CString::new(path.as_os_str().as_bytes()).unwrap();
    // SAFETY: a NUL-terminated test-owned path.
    assert_eq!(unsafe { libc::mkfifo(cpath.as_ptr(), 0o600) }, 0);
    assert!(
        tokio::time::timeout(Duration::from_secs(1), art.cached(SOURCE, &worker))
            .await
            .unwrap()
            .is_none()
    );
}
#[tokio::test]
async fn failed_http_status_redirect_oversize_and_timeout_keep_cache_empty() {
    for (response, delay) in [
        (b"HTTP/1.1 404 Missing\r\nContent-Length: 0\r\n\r\n".to_vec(), Duration::ZERO),
        (b"HTTP/1.1 302 Found\r\nLocation: https://example.test/redirect\r\nContent-Length: 0\r\n\r\n".to_vec(), Duration::ZERO),
        (b"HTTP/1.1 200 OK\r\nContent-Length: 8388609\r\n\r\n".to_vec(), Duration::ZERO),
        (b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n".to_vec(), Duration::from_millis(200)),
    ] {
        let root = tempfile::tempdir().unwrap();
        let cache = root.path().join("artwork");
        let art = Artwork::new(cache.clone(), fixture_http(response, delay));
        assert!(art.fetch(SOURCE, &BlockingWorker::new(2)).await.is_none());
        assert_eq!(std::fs::read_dir(cache).unwrap().count(), 0);
    }
}
#[tokio::test(start_paused = true)]
async fn transient_failure_retries_once_and_permanent_failure_has_a_cooldown() {
    let root = tempfile::tempdir().unwrap();
    let fetcher = Reply::new([Err(Failure::Network), Ok(b"recovered art".to_vec())]);
    let art = Artwork::new(root.path().join("recover"), fetcher.clone());
    let worker = BlockingWorker::new(2);
    assert!(
        art.fetch(SOURCE, &worker).await.is_some(),
        "transient failure did not recover without a metadata event"
    );
    assert_eq!(fetcher.calls.load(Ordering::SeqCst), 2);
    let failed = Reply::new([Err(Failure::Auth), Ok(b"later art".to_vec())]);
    let art = Artwork::new(root.path().join("failed"), failed.clone());
    assert!(art.fetch(SOURCE, &worker).await.is_none());
    assert!(art.fetch(SOURCE, &worker).await.is_none());
    assert_eq!(failed.calls.load(Ordering::SeqCst), 1);
    tokio::time::advance(Duration::from_secs(61)).await;
    assert!(art.fetch(SOURCE, &worker).await.is_some());
}

struct HangingFetch(AtomicUsize);
impl Fetcher for HangingFetch {
    fn get(&self, _url: reqwest::Url, _limit: usize) -> FetchFuture<'_> {
        self.0.fetch_add(1, Ordering::SeqCst);
        Box::pin(std::future::pending())
    }
}
#[tokio::test(start_paused = true)]
async fn artwork_timeout_bounds_a_fetcher_that_never_finishes() {
    let root = tempfile::tempdir().unwrap();
    let fetcher = Arc::new(HangingFetch(AtomicUsize::new(0)));
    let art = Artwork::new(root.path().join("artwork"), fetcher.clone());
    let start = tokio::time::Instant::now();
    assert!(art.fetch(SOURCE, &BlockingWorker::new(2)).await.is_none());
    assert!(start.elapsed() >= Duration::from_secs(10));
    assert!(start.elapsed() <= Duration::from_secs(13));
    assert_eq!(fetcher.0.load(Ordering::SeqCst), 2);
}
struct SlowFetch(AtomicUsize);
impl Fetcher for SlowFetch {
    fn get(&self, _url: reqwest::Url, _limit: usize) -> FetchFuture<'_> {
        self.0.fetch_add(1, Ordering::SeqCst);
        Box::pin(async {
            tokio::time::sleep(Duration::from_millis(20)).await;
            Ok(b"shared artwork".to_vec())
        })
    }
}
#[tokio::test]
async fn concurrent_requests_for_one_uri_share_the_download() {
    let root = tempfile::tempdir().unwrap();
    let fetcher = Arc::new(SlowFetch(AtomicUsize::new(0)));
    let art = Artwork::new(root.path().join("artwork"), fetcher.clone());
    let worker = BlockingWorker::new(2);
    let (first, second, third) = tokio::join!(
        art.fetch(SOURCE, &worker),
        art.fetch(SOURCE, &worker),
        art.fetch(SOURCE, &worker)
    );
    assert!(first.is_some());
    assert_eq!(first, second);
    assert_eq!(first, third);
    assert_eq!(fetcher.0.load(Ordering::SeqCst), 1);
}
