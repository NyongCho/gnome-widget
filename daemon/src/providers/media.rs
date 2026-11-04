//! MPRIS subscriptions belong to the collection future: cancelling it releases bus matches.
use crate::{
    http::Fetcher,
    state::Failure,
    types::{MediaData, PlaybackStatus},
    worker::BlockingWorker,
};
use futures_util::{StreamExt, stream};
use serde_json::Value;
use std::{
    collections::HashMap, fs::OpenOptions, os::unix::fs::OpenOptionsExt, path::PathBuf, sync::Arc,
    time::Duration,
};
use zbus::{Connection, MatchRule, MessageStream, zvariant::OwnedValue};
const IFACE: &str = "org.mpris.MediaPlayer2.Player";
const PATH: &str = "/org/mpris/MediaPlayer2";
pub fn select_player(mut players: Vec<MediaData>) -> Option<MediaData> {
    players.retain(|p| p.status == PlaybackStatus::Playing);
    players.sort_by(|a, b| a.player.cmp(&b.player));
    players.into_iter().next()
}
pub fn local_art(uri: &str) -> Option<String> {
    if uri.len() > 4096 {
        return None;
    }
    let url = reqwest::Url::parse(uri).ok()?;
    if url.scheme() != "file"
        || url.host_str().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return None;
    }
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NONBLOCK)
        .open(url.to_file_path().ok()?)
        .ok()?;
    let metadata = file.metadata().ok()?;
    (metadata.is_file() && metadata.len() <= 8 * 1024 * 1024).then(|| url.to_string())
}
fn text(value: Option<&OwnedValue>) -> String {
    value
        .and_then(|v| <&str>::try_from(v).ok())
        .unwrap_or_default()
        .chars()
        .take(4096)
        .collect()
}
async fn players(connection: &Connection) -> zbus::Result<Vec<MediaData>> {
    let bus = zbus::fdo::DBusProxy::new(connection).await?;
    let mut names = bus
        .list_names()
        .await?
        .into_iter()
        .filter(|n| n.starts_with("org.mpris.MediaPlayer2."))
        .map(|n| n.to_string())
        .collect::<Vec<_>>();
    names.sort();
    names.truncate(32);
    Ok(stream::iter(names)
        .map(|name| async move {
            let query = async {
                let proxy = zbus::Proxy::new(
                    connection,
                    name.as_str(),
                    PATH,
                    "org.freedesktop.DBus.Properties",
                )
                .await
                .ok()?;
                let mut props: HashMap<String, OwnedValue> =
                    proxy.call("GetAll", &IFACE).await.ok()?;
                let status = match text(props.get("PlaybackStatus")).as_str() {
                    "Playing" => PlaybackStatus::Playing,
                    "Paused" => PlaybackStatus::Paused,
                    "Stopped" => PlaybackStatus::Stopped,
                    _ => return None,
                };
                let metadata: HashMap<String, OwnedValue> =
                    props.remove("Metadata")?.try_into().ok()?;
                let artist = metadata
                    .get("xesam:artist")
                    .and_then(|v| v.try_clone().ok())
                    .and_then(|v| Vec::<String>::try_from(v).ok())
                    .unwrap_or_default()
                    .join(", ")
                    .chars()
                    .take(4096)
                    .collect();
                let art = text(metadata.get("mpris:artUrl"));
                Some(MediaData {
                    player: name,
                    status,
                    title: text(metadata.get("xesam:title")),
                    artist,
                    art_uri: (!art.is_empty()).then_some(art),
                })
            };
            tokio::time::timeout(Duration::from_secs(2), query)
                .await
                .ok()
                .flatten()
        })
        .buffer_unordered(8)
        .filter_map(std::future::ready)
        .collect()
        .await)
}
pub struct Media {
    artwork: super::media_art::Artwork,
}
impl Media {
    pub fn new(cache_root: PathBuf, fetcher: Arc<dyn Fetcher>) -> Self {
        Self {
            artwork: super::media_art::Artwork::new(cache_root, fetcher),
        }
    }
    pub async fn collect_on(
        &self,
        connection: &Connection,
        previous: Option<Value>,
        worker: BlockingWorker,
    ) -> Result<MediaData, Failure> {
        let run = async {
            let changes = MatchRule::builder()
                .msg_type(zbus::message::Type::Signal)
                .interface("org.freedesktop.DBus.Properties")?
                .member("PropertiesChanged")?
                .path(PATH)?
                .arg(0, IFACE)?
                .build();
            let owners = MatchRule::builder()
                .msg_type(zbus::message::Type::Signal)
                .sender("org.freedesktop.DBus")?
                .interface("org.freedesktop.DBus")?
                .member("NameOwnerChanged")?
                .arg0ns("org.mpris.MediaPlayer2")?
                .build();
            let mut changes = MessageStream::for_match_rule(changes, connection, Some(64)).await?;
            let mut owners = MessageStream::for_match_rule(owners, connection, Some(64)).await?;
            loop {
                let mut selected = select_player(players(connection).await?);
                let original = selected.clone();
                let source = selected.as_mut().and_then(|data| data.art_uri.take());
                let resolve = async {
                    match source.as_deref() {
                        Some(uri) => self.artwork.cached(uri, &worker).await,
                        None => None,
                    }
                };
                let uri = tokio::select! {
                    biased;
                    message = changes.next() => { check_signal(message)?; continue; }
                    message = owners.next() => { check_signal(message)?; continue; }
                    uri = resolve => uri,
                };
                if let Some(data) = &mut selected {
                    data.art_uri = uri;
                }
                let value = serde_json::to_value(&selected).expect("serializable media");
                if previous.as_ref() != Some(&value) {
                    // Publish new metadata with a generic icon immediately. The next
                    // collection may fetch its artwork without retaining the old cover.
                    return Ok(selected);
                }
                if let Some(source) = source
                    && selected.as_ref().is_some_and(|data| data.art_uri.is_none())
                {
                    let uri = tokio::select! {
                        biased;
                        message = changes.next() => { check_signal(message)?; continue; }
                        message = owners.next() => { check_signal(message)?; continue; }
                        uri = self.artwork.fetch(&source, &worker) => uri,
                    };
                    if let Some(uri) = uri {
                        // A completed request cannot authorize its old player
                        // snapshot, even when the change signal is still in transit.
                        if select_player(players(connection).await?) != original {
                            continue;
                        }
                        selected.as_mut().expect("selected player").art_uri = Some(uri);
                        return Ok(selected);
                    }
                }
                let signal = tokio::select! {
                    message = changes.next() => message,
                    message = owners.next() => message,
                };
                check_signal(signal)?;
            }
        };
        run.await
            .map_err(|_: zbus::Error| Failure::Unavailable)?
            .ok_or(Failure::NoPlayer)
    }
    pub async fn collect(
        &self,
        previous: Option<Value>,
        worker: BlockingWorker,
    ) -> Result<MediaData, Failure> {
        match Connection::session().await {
            Ok(connection) => self.collect_on(&connection, previous, worker).await,
            Err(_) => Err(Failure::Unavailable),
        }
    }
}
fn check_signal(message: Option<zbus::Result<zbus::Message>>) -> zbus::Result<()> {
    match message {
        Some(Ok(_)) => Ok(()),
        Some(Err(error)) => Err(error),
        None => Err(zbus::Error::Failure("media connection closed".into())),
    }
}
