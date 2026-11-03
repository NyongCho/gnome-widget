use liquid_widgets_daemon::{
    http::{FetchFuture, Fetcher},
    providers::weather::{Weather, parse_forecast, parse_locations},
    schedule::poll_seconds,
    state::Failure,
    types::{ProviderName, WeatherLocation},
};
use std::sync::{Arc, Mutex};
fn location() -> WeatherLocation {
    WeatherLocation {
        id: "1835848".into(),
        label: "서울".into(),
        latitude: 37.566,
        longitude: 126.9784,
        time_zone: "Asia/Seoul".into(),
    }
}
#[test]
fn search_retains_coordinates_and_timezone_and_ignores_incomplete_rows() {
    let results = parse_locations(include_bytes!(
        "../../tests/fixtures/weather/locations.json"
    ))
    .unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].time_zone, "Asia/Seoul");
    assert_eq!(results[0].latitude, 37.566);
    assert!(results[0].label.contains("대한민국"));
    assert!(parse_locations(b"{}").unwrap().is_empty());
    assert_eq!(parse_locations(b"{\"error\":true}"), Err(Failure::Invalid));
}
#[test]
fn unix_hours_cross_local_midnight_and_missing_values_remain_null() {
    let now = 1793802600;
    let data = parse_forecast(
        include_bytes!("../../tests/fixtures/weather/forecast.json"),
        &location(),
        now,
    )
    .unwrap();
    assert_eq!(data.current.temperature_c, None);
    assert_eq!(data.current.code, Some(3));
    assert_eq!(data.hourly.len(), 6);
    assert_eq!(data.hourly[0].at, "2026-11-04T15:00:00Z");
    assert_eq!(data.hourly[1].temperature_c, None);
    assert_eq!(data.hourly[1].precipitation_probability, None);
    assert_eq!(data.hourly[2].temperature_c, Some(0.0));
    assert_eq!(data.time_zone, "Asia/Seoul");
}
#[test]
fn malformed_arrays_and_api_errors_are_not_zero_weather() {
    assert_eq!(
        parse_forecast(b"{\"error\":true}", &location(), 0),
        Err(Failure::Invalid)
    );
    let data = parse_forecast(
        br#"{"current":{},"hourly":{"time":[1793804400]}}"#,
        &location(),
        1793802600,
    )
    .unwrap();
    assert!(data.current.code.is_none());
    assert!(data.hourly[0].temperature_c.is_none());
}
struct Reply {
    result: Result<Vec<u8>, Failure>,
    urls: Mutex<Vec<reqwest::Url>>,
}
impl Fetcher for Reply {
    fn get(&self, url: reqwest::Url, _limit: usize) -> FetchFuture<'_> {
        self.urls.lock().unwrap().push(url);
        Box::pin(async { self.result.clone() })
    }
}
#[tokio::test]
async fn requests_use_utc_epochs_and_propagate_429_and_network_failure() {
    let reply = Arc::new(Reply {
        result: Err(Failure::RateLimited),
        urls: Mutex::new(vec![]),
    });
    let weather = Weather {
        fetcher: reply.clone(),
    };
    assert_eq!(
        weather.collect(&location(), 1793802600).await,
        Err(Failure::RateLimited)
    );
    {
        let urls = reply.urls.lock().unwrap();
        assert_eq!(urls[0].host_str(), Some("api.open-meteo.com"));
        let params = urls[0]
            .query_pairs()
            .collect::<std::collections::BTreeMap<_, _>>();
        assert_eq!(params.get("timeformat").unwrap(), "unixtime");
        assert_eq!(params.get("forecast_hours").unwrap(), "7");
    }
    let weather = Weather {
        fetcher: Arc::new(Reply {
            result: Err(Failure::Network),
            urls: Mutex::new(vec![]),
        }),
    };
    assert_eq!(weather.search("서울").await, Err(Failure::Network));
}
#[test]
fn weather_backoff_is_bounded_and_resets_after_success() {
    assert_eq!(poll_seconds(ProviderName::Weather, 0, false), 900);
    assert_eq!(poll_seconds(ProviderName::Weather, 1, false), 30);
    assert_eq!(poll_seconds(ProviderName::Weather, 2, false), 60);
    assert_eq!(poll_seconds(ProviderName::Weather, 100, false), 900);
    assert_eq!(poll_seconds(ProviderName::Weather, 1, true), 900);
    assert_eq!(poll_seconds(ProviderName::System, 1, false), 2);
}

#[tokio::test]
#[ignore = "live Open-Meteo endpoints; no user location is saved"]
async fn live_open_meteo_search_and_forecast() {
    let weather = Weather {
        fetcher: Arc::new(liquid_widgets_daemon::http::Http::new().unwrap()),
    };
    let locations = weather.search("Seoul").await.unwrap();
    assert!(!locations.is_empty());
    let selected = locations
        .iter()
        .find(|l| l.id == "1835848")
        .unwrap_or(&locations[0]);
    let now = chrono::DateTime::<chrono::Utc>::from(std::time::SystemTime::now()).timestamp();
    let data = weather.collect(selected, now).await.unwrap();
    assert_eq!(data.hourly.len(), 6);
    assert!(data.current.temperature_c.is_some());
    assert_eq!(data.attribution_url, "https://open-meteo.com/");
}
