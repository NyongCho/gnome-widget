use liquid_widgets_daemon::{
    http::{FetchFuture, Fetcher},
    providers::{Providers, calendar_feed::CalendarFeed, weather::Weather},
    secrets::NoSecrets,
    service::{Runtime, Server},
    state::Failure,
};
use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
struct Fetch(AtomicBool);
impl Fetcher for Fetch {
    fn get(&self, url: reqwest::Url, _limit: usize) -> FetchFuture<'_> {
        Box::pin(async move {
            if self.0.load(Ordering::SeqCst) {
                return Err(Failure::Network);
            }
            if url.host_str() == Some("geocoding-api.open-meteo.com") {
                return Ok(include_bytes!("../../tests/fixtures/weather/locations.json").to_vec());
            }
            let now =
                chrono::DateTime::<chrono::Utc>::from(std::time::SystemTime::now()).timestamp();
            Ok(serde_json::json!({"current":{"temperature_2m":12,"weather_code":0},"hourly":{"time":[now+3600],"temperature_2m":[13],"precipitation_probability":[25]}}).to_string().into_bytes())
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
fn weather_search_select_failure_and_clear_over_real_dbus() {
    if std::env::var_os("LIQUID_WEATHER_TEST").is_none() {
        let status = std::process::Command::new("dbus-run-session")
            .arg("--")
            .arg(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "weather_search_select_failure_and_clear_over_real_dbus",
            ])
            .env("LIQUID_WEATHER_TEST", "1")
            .status()
            .unwrap();
        assert!(status.success());
        return;
    }
    tokio::runtime::Runtime::new().unwrap().block_on(async {
        let dir = tempfile::tempdir().unwrap();
        let fetch = Arc::new(Fetch(AtomicBool::new(false)));
        let secrets = Arc::new(NoSecrets);
        let providers = Arc::new(Providers {
            media: liquid_widgets_daemon::providers::media::Media::new(
                dir.path().join("cache/artwork"),
                fetch.clone(),
            ),
            system: Default::default(),
            network: Default::default(),
            calendar: CalendarFeed {
                fetcher: fetch.clone(),
                secrets,
            },
            weather: Weather {
                fetcher: fetch.clone(),
            },
        });
        let runtime = Runtime::new(
            dir.path().join("config"),
            dir.path().join("cache"),
            providers,
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
        let results: String = proxy.call("SearchLocations", &"서울").await.unwrap();
        let locations =
            liquid_widgets_daemon::validation::parse_location_search_results(&results).unwrap();
        assert_eq!(locations.len(), 1);
        assert_eq!(
            runtime.snapshot().await.unwrap()["weather"]["status"],
            "unconfigured"
        );
        proxy
            .call::<_, _, ()>(
                "SetWeatherLocation",
                &serde_json::to_string(&locations[0]).unwrap(),
            )
            .await
            .unwrap();
        let _: String = proxy.call("Subscribe", &(vec!["weather"],)).await.unwrap();
        until(async || runtime.snapshot().await.unwrap()["weather"]["status"] == "ok").await;
        let before = runtime.snapshot().await.unwrap()["weather"].clone();
        assert_eq!(
            before["data"]["current"]["temperatureC"].as_f64(),
            Some(12.0)
        );
        fetch.0.store(true, Ordering::SeqCst);
        tokio::time::sleep(Duration::from_millis(1100)).await;
        assert!(
            proxy
                .call::<_, _, String>("SearchLocations", &"Seoul")
                .await
                .is_err()
        );
        assert_eq!(before, runtime.snapshot().await.unwrap()["weather"]);
        proxy.call::<_, _, ()>("Refresh", &"weather").await.unwrap();
        assert!(proxy.call::<_, _, ()>("Refresh", &"weather").await.is_err());
        until(async || runtime.snapshot().await.unwrap()["weather"]["status"] == "stale").await;
        let stale = runtime.snapshot().await.unwrap()["weather"].clone();
        assert_eq!(stale["updatedAt"], before["updatedAt"]);
        assert_eq!(stale["data"], before["data"]);
        proxy
            .call::<_, _, ()>("SetWeatherLocation", &"null")
            .await
            .unwrap();
        assert!(runtime.snapshot().await.unwrap()["weather"]["data"].is_null());
        server.shutdown().await.unwrap();
    });
}
