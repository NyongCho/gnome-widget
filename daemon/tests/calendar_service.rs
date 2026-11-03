use liquid_widgets_daemon::{
    cache::PrivateStore,
    config::Config,
    http::{FetchFuture, Fetcher},
    providers::{Providers, calendar_feed::CalendarFeed},
    secrets::{SecretError, SecretFuture, SecretStore},
    service::{Runtime, Server},
    state::Failure,
    types::ProviderName,
};
use std::{
    collections::BTreeMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
#[derive(Default)]
struct Secrets(Mutex<BTreeMap<String, String>>);
impl SecretStore for Secrets {
    fn read(&self, source: String) -> SecretFuture<'_, String> {
        Box::pin(async move {
            self.0
                .lock()
                .unwrap()
                .get(&source)
                .cloned()
                .ok_or(SecretError)
        })
    }
    fn write(&self, source: String, url: String) -> SecretFuture<'_, ()> {
        Box::pin(async move {
            self.0.lock().unwrap().insert(source, url);
            Ok(())
        })
    }
    fn delete(&self, source: Option<String>) -> SecretFuture<'_, ()> {
        Box::pin(async move {
            let mut values = self.0.lock().unwrap();
            if let Some(source) = source {
                values.remove(&source);
            } else {
                values.clear();
            }
            Ok(())
        })
    }
}
struct Fetch(AtomicBool);
impl Fetcher for Fetch {
    fn get(&self, _url: reqwest::Url, _limit: usize) -> FetchFuture<'_> {
        Box::pin(async {
            if self.0.load(Ordering::SeqCst) {
                return Err(Failure::Network);
            }
            Ok(b"BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:service-fixture\r\nDTSTART:20261105T090000\r\nDTEND:20261105T100000\r\nSUMMARY:service fixture\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n".to_vec())
        })
    }
}
async fn until(mut predicate: impl AsyncFnMut() -> bool) {
    tokio::time::timeout(Duration::from_secs(3), async {
        while !predicate().await {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
}
#[test]
fn calendar_ipc_connect_offline_context_disconnect_and_restart() {
    if std::env::var_os("LIQUID_CALENDAR_TEST").is_none() {
        let status = std::process::Command::new("dbus-run-session")
            .arg("--")
            .arg(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "calendar_ipc_connect_offline_context_disconnect_and_restart",
            ])
            .env("LIQUID_CALENDAR_TEST", "1")
            .status()
            .unwrap();
        assert!(status.success());
        return;
    }
    tokio::runtime::Runtime::new().unwrap().block_on(async {
        let dir = tempfile::tempdir().unwrap();
        let config = dir.path().join("config");
        let cache = dir.path().join("cache");
        let secrets = Arc::new(Secrets::default());
        let fetcher = Arc::new(Fetch(AtomicBool::new(false)));
        let providers = Arc::new(Providers {
            calendar: CalendarFeed {
                fetcher: fetcher.clone(),
                secrets: secrets.clone(),
            },
        });
        let runtime = Runtime::new_with_secrets(
            config.clone(),
            cache.clone(),
            providers.clone(),
            secrets.clone(),
        )
        .await
        .unwrap();
        let server = Server::start(runtime.clone()).await.unwrap();
        let conn = zbus::Connection::session().await.unwrap();
        let proxy = zbus::Proxy::new(
            &conn,
            "org.local.LiquidWidgets",
            "/org/local/LiquidWidgets",
            "org.local.LiquidWidgets1",
        )
        .await
        .unwrap();
        proxy
            .call::<_, _, ()>(
                "SetCalendarContext",
                &r#"{"month":"2026-11","timeZone":"Asia/Seoul","weekStart":1}"#,
            )
            .await
            .unwrap();
        let _: String = proxy.call("Subscribe", &(vec!["calendar"],)).await.unwrap();
        proxy
            .call::<_, _, ()>(
                "SetCalendarSecret",
                &"https://calendar.google.com/calendar/ical/fixture/private-token/basic.ics",
            )
            .await
            .unwrap();
        until(async || runtime.snapshot().await.unwrap()["calendar"]["status"] == "ok").await;
        let fresh = runtime.snapshot().await.unwrap()["calendar"].clone();
        assert_eq!(fresh["data"]["events"][0]["title"], "service fixture");
        assert!(!fresh.to_string().contains("private-token"));
        let persisted = Config::load(&PrivateStore::new(&config).unwrap()).unwrap();
        let store = PrivateStore::new(&cache).unwrap();
        assert!(
            store
                .read_calendar(&persisted.sources[&ProviderName::Calendar])
                .unwrap()
                .is_some()
        );
        fetcher.0.store(true, Ordering::SeqCst);
        proxy
            .call::<_, _, ()>(
                "SetCalendarContext",
                &r#"{"month":"2026-11","timeZone":"UTC","weekStart":0}"#,
            )
            .await
            .unwrap();
        until(async || runtime.snapshot().await.unwrap()["calendar"]["status"] == "stale").await;
        let stale = runtime.snapshot().await.unwrap()["calendar"].clone();
        assert_eq!(stale["data"]["timeZone"], "UTC");
        assert_eq!(stale["updatedAt"], fresh["updatedAt"]);
        proxy
            .call::<_, _, ()>("ClearCalendarSecret", &())
            .await
            .unwrap();
        assert_eq!(
            runtime.snapshot().await.unwrap()["calendar"]["status"],
            "unconfigured"
        );
        assert!(std::fs::read_dir(&cache).unwrap().next().is_none());
        assert!(secrets.0.lock().unwrap().is_empty());
        server.shutdown().await.unwrap();
        let restarted = Runtime::new_with_secrets(config, cache, providers, secrets)
            .await
            .unwrap();
        assert!(restarted.snapshot().await.unwrap()["calendar"]["data"].is_null());
    });
}
