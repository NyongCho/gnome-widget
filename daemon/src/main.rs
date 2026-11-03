use liquid_widgets_daemon::service::{Runtime, Server, UnavailableCollector};
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
        eprintln!("Liquid Widgets service could not start or continue");
        std::process::exit(1);
    }
}
async fn run() -> Result<(), Box<dyn std::error::Error>> {
    let runtime = Runtime::new(
        directory("XDG_CONFIG_HOME", ".config")?,
        directory("XDG_CACHE_HOME", ".cache")?,
        Arc::new(UnavailableCollector),
    )
    .await?;
    let server = Server::start(runtime).await?;
    let mut terminate = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
    tokio::select! {_=tokio::signal::ctrl_c()=>{},_=terminate.recv()=>{},_=server.closed()=>{}}
    server.shutdown().await?;
    Ok(())
}
