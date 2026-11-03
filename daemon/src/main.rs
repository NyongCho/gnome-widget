use liquid_widgets_daemon::service::{Runtime, Server};
use std::{path::PathBuf, sync::Arc};
fn directory(variable: &str, fallback: &str) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let root = if let Some(path) = std::env::var_os(variable) {
        PathBuf::from(path)
    } else {
        PathBuf::from(std::env::var_os("HOME").ok_or("home directory unavailable")?).join(fallback)
    };
    if !root.is_absolute() {
        return Err("XDG directory must be absolute".into());
    }
    Ok(root.join("liquid-widgets"))
}
#[tokio::main]
async fn main() {
    if run().await.is_err() {
        if std::env::args().any(|arg| arg == "--clear-calendar") {
            eprintln!(
                "Calendar deletion failed. Unlock the keyring and retry; removal is not complete."
            );
        } else {
            eprintln!("Liquid Widgets service could not start or continue");
        }
        std::process::exit(1);
    }
}
async fn run() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args == ["--clear-calendar"] {
        let connection = zbus::Connection::session().await?;
        let bus = zbus::fdo::DBusProxy::new(&connection).await?;
        if bus
            .name_has_owner("org.local.LiquidWidgets".try_into()?)
            .await?
        {
            let proxy = zbus::Proxy::new(
                &connection,
                "org.local.LiquidWidgets",
                "/org/local/LiquidWidgets",
                "org.local.LiquidWidgets1",
            )
            .await?;
            proxy.call::<_, _, ()>("ClearCalendarSecret", &()).await?;
        } else {
            let runtime = Runtime::new_with_secrets(
                directory("XDG_CONFIG_HOME", ".config")?,
                directory("XDG_CACHE_HOME", ".cache")?,
                Arc::new(liquid_widgets_daemon::service::UnavailableCollector),
                Arc::new(liquid_widgets_daemon::secrets::SystemSecrets),
            )
            .await?;
            runtime.clear_calendar_secret().await?;
        }
        return Ok(());
    }
    if !args.is_empty() {
        return Err("unknown service argument".into());
    }
    let secrets = Arc::new(liquid_widgets_daemon::secrets::SystemSecrets);
    let fetcher =
        Arc::new(liquid_widgets_daemon::http::Http::new().map_err(|_| "HTTP client unavailable")?);
    let providers = liquid_widgets_daemon::providers::Providers {
        system: Default::default(),
        network: Default::default(),
        weather: liquid_widgets_daemon::providers::weather::Weather {
            fetcher: fetcher.clone(),
        },
        calendar: liquid_widgets_daemon::providers::calendar_feed::CalendarFeed {
            fetcher: fetcher.clone(),
            secrets: secrets.clone(),
        },
    };
    let runtime = Runtime::new_with_secrets(
        directory("XDG_CONFIG_HOME", ".config")?,
        directory("XDG_CACHE_HOME", ".cache")?,
        Arc::new(providers),
        secrets,
    )
    .await?;
    let server = Server::start(runtime).await?;
    let mut terminate = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
    tokio::select! {_=tokio::signal::ctrl_c()=>{},_=terminate.recv()=>{},_=server.closed()=>{}}
    server.shutdown().await?;
    Ok(())
}
