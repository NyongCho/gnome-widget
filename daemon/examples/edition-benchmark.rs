//! Development fixture only: production providers/server, synthetic HTTP and secrets.
//! Never installed or included in either release package.
use liquid_widgets_daemon::{
    http::{FetchFuture, Fetcher},
    providers::{self, Providers},
    secrets::{SecretFuture, SecretStore},
    service::{Runtime, Server, SettingChange},
    state::Failure,
};
use std::{path::PathBuf, sync::Arc};
const URL: &str = "https://calendar.google.com/calendar/ical/benchmark/public/basic.ics";
struct SyntheticSecrets;
impl SecretStore for SyntheticSecrets {
    fn read(&self, _: String) -> SecretFuture<'_, String> {
        Box::pin(async { Ok(URL.into()) })
    }
    fn write(&self, _: String, _: String) -> SecretFuture<'_, ()> {
        Box::pin(async { Ok(()) })
    }
    fn delete(&self, _: Option<String>) -> SecretFuture<'_, ()> {
        Box::pin(async { Ok(()) })
    }
}
struct SyntheticHttp(PathBuf);
impl Fetcher for SyntheticHttp {
    fn get(&self, url: reqwest::Url, limit: usize) -> FetchFuture<'_> {
        Box::pin(async move {
            let directory = self.0.clone();
            let weather = url.host_str() == Some("api.open-meteo.com");
            let bytes = tokio::task::spawn_blocking(move || {
                let name = if weather {
                    "weather.json".into()
                } else {
                    let name = std::fs::read_to_string(directory.join("selection.txt"))?;
                    if !["1k", "10k", "5mib", "sparse"].contains(&name.trim()) {
                        return Err(std::io::Error::other("invalid fixture"));
                    }
                    format!("{}.ics", name.trim())
                };
                std::fs::read(directory.join(name))
            })
            .await
            .map_err(|_| Failure::Unavailable)?
            .map_err(|_| Failure::Network)?;
            if bytes.len() > limit {
                return Err(Failure::TooLarge);
            }
            Ok(bytes)
        })
    }
}
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    if std::env::var("GSETTINGS_BACKEND").as_deref() != Ok("keyfile") {
        return Err("private benchmark environment required".into());
    }
    let fixtures = PathBuf::from(std::env::var("LIQUID_BENCH_FIXTURES")?);
    let cache = PathBuf::from(std::env::var("XDG_CACHE_HOME")?).join("liquid-widgets");
    let config = PathBuf::from(std::env::var("XDG_CONFIG_HOME")?).join("liquid-widgets");
    let http = Arc::new(SyntheticHttp(fixtures));
    let secrets = Arc::new(SyntheticSecrets);
    let providers = Providers {
        system: Default::default(),
        network: Default::default(),
        media: providers::media::Media::new(cache.join("artwork"), http.clone()),
        weather: providers::weather::Weather {
            fetcher: http.clone(),
        },
        calendar: providers::calendar_feed::CalendarFeed {
            fetcher: http,
            secrets: secrets.clone(),
        },
    };
    let runtime = Runtime::new_with_secrets(config, cache, Arc::new(providers), secrets).await?;
    runtime.set_calendar_secret(URL.into()).await?;
    runtime.configure(SettingChange::Weather(Some(serde_json::from_str(r#"{"id":"1","label":"Synthetic Seoul","latitude":37.56,"longitude":126.97,"timeZone":"UTC"}"#)?))).await?;
    let server = Server::start(runtime).await?;
    let mut terminate = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
    tokio::select! {_=tokio::signal::ctrl_c()=>{},_=terminate.recv()=>{},_=server.closed()=>{}}
    server.shutdown().await?;
    Ok(())
}
