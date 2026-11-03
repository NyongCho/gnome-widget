use liquid_widgets_daemon::{
    http::{FetchFuture, Fetcher, Http},
    providers::calendar_feed::CalendarFeed,
    secrets::{SecretError, SecretFuture, SecretStore},
    state::Failure,
    types::CalendarContext,
    worker::BlockingWorker,
};
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
const ICS: &str = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:test\r\nDTSTART:20261215T090000\r\nDTEND:20261215T100000\r\nSUMMARY:private event\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
struct Secrets(AtomicBool);
impl SecretStore for Secrets {
    fn read(&self, _source: String) -> SecretFuture<'_, String> {
        Box::pin(async move {
            if self.0.load(Ordering::SeqCst) {
                Err(SecretError)
            } else {
                Ok(
                    "https://calendar.google.com/calendar/ical/x/private-sensitive/basic.ics"
                        .into(),
                )
            }
        })
    }
    fn write(&self, _source: String, _url: String) -> SecretFuture<'_, ()> {
        Box::pin(async { Ok(()) })
    }
    fn delete(&self, _source: Option<String>) -> SecretFuture<'_, ()> {
        Box::pin(async { Ok(()) })
    }
}
struct Fetch(AtomicBool);
impl Fetcher for Fetch {
    fn get(&self, _url: reqwest::Url, _limit: usize) -> FetchFuture<'_> {
        Box::pin(async {
            if self.0.load(Ordering::SeqCst) {
                Err(Failure::Network)
            } else {
                Ok(ICS.as_bytes().to_vec())
            }
        })
    }
}
#[tokio::test]
async fn original_ics_reexpands_offline_for_new_context_and_preserves_fetch_timestamp() {
    let fetcher = Arc::new(Fetch(AtomicBool::new(false)));
    let secrets = Arc::new(Secrets(AtomicBool::new(false)));
    let feed = CalendarFeed {
        fetcher: fetcher.clone(),
        secrets: secrets.clone(),
    };
    let context = CalendarContext {
        month: "2026-11".into(),
        time_zone: "Asia/Seoul".into(),
        week_start: 1,
    };
    let now = "2026-11-04T00:00:00Z".to_owned();
    let first = feed
        .collect(
            "source-a",
            context.clone(),
            now.clone(),
            None,
            BlockingWorker::new(2),
        )
        .await
        .unwrap();
    assert!(first.data.events.is_empty());
    assert!(first.stale.is_none());
    fetcher.0.store(true, Ordering::SeqCst);
    let second = feed
        .collect(
            "source-a",
            CalendarContext {
                month: "2026-12".into(),
                ..context.clone()
            },
            "2026-12-01T00:00:00Z".into(),
            Some(first.cached),
            BlockingWorker::new(2),
        )
        .await
        .unwrap();
    assert_eq!(second.data.month, "2026-12");
    assert_eq!(second.data.events.len(), 1);
    assert_eq!(second.cached.fetched_at, now);
    assert_eq!(second.stale, Some(Failure::Network));
    secrets.0.store(true, Ordering::SeqCst);
    let result = feed
        .collect(
            "source-a",
            context,
            now,
            Some(second.cached),
            BlockingWorker::new(2),
        )
        .await;
    assert!(matches!(result, Err(Failure::Keyring)));
}
fn serve(response: &str, delay: Duration) -> reqwest::Url {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/feed", listener.local_addr().unwrap());
    let response = response.to_owned();
    std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut request = [0; 1024];
        let _ = stream.read(&mut request);
        std::thread::sleep(delay);
        let _ = stream.write_all(response.as_bytes());
    });
    reqwest::Url::parse(&url).unwrap()
}
#[tokio::test]
async fn bounded_http_rejects_status_oversize_redirect_and_timeout_without_exposing_url() {
    let http = Http::with_client(
        reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_millis(100))
            .build()
            .unwrap(),
    );
    for (response, expected) in [
        (
            "HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: close\r\n\r\nhello",
            Ok(b"hello".to_vec()),
        ),
        (
            "HTTP/1.1 200 OK\r\nContent-Length: 11\r\nConnection: close\r\n\r\n01234567890",
            Err(Failure::TooLarge),
        ),
        (
            "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n",
            Err(Failure::Auth),
        ),
        (
            "HTTP/1.1 429 Limited\r\nContent-Length: 0\r\n\r\n",
            Err(Failure::RateLimited),
        ),
        (
            "HTTP/1.1 302 Found\r\nLocation: https://evil.test/private-sensitive\r\nContent-Length: 0\r\n\r\n",
            Err(Failure::Network),
        ),
    ] {
        assert_eq!(
            http.get(serve(response, Duration::ZERO), 10).await,
            expected
        );
    }
    assert_eq!(
        http.get(
            serve(
                "HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n",
                Duration::from_millis(200)
            ),
            10
        )
        .await,
        Err(Failure::Network)
    );
}

#[tokio::test]
#[ignore = "live Google public feed; run explicitly, no private account"]
async fn live_google_public_calendar_format_probe() {
    let url=liquid_widgets_daemon::secrets::validate_calendar_url("https://calendar.google.com/calendar/ical/en.south_korea%23holiday%40group.v.calendar.google.com/public/basic.ics").unwrap();
    let bytes = Http::new()
        .unwrap()
        .get(
            url,
            liquid_widgets_daemon::providers::calendar::MAX_ICS_BYTES,
        )
        .await
        .unwrap();
    let text = String::from_utf8(bytes).unwrap();
    let events = liquid_widgets_daemon::providers::calendar::expand_ics(
        &text,
        &CalendarContext {
            month: "2026-10".into(),
            time_zone: "Asia/Seoul".into(),
            week_start: 0,
        },
        "2026-10-01T00:00:00Z",
    )
    .unwrap();
    assert!(
        !events.is_empty(),
        "public Google feed contained no events in the fixture range"
    );
}
