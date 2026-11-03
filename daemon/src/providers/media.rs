//! MPRIS subscriptions belong to the collection future: cancelling it releases bus matches.
use crate::{
    state::Failure,
    types::{MediaData, PlaybackStatus},
    worker::BlockingWorker,
};
use futures_util::{StreamExt, stream};
use serde_json::Value;
use std::{collections::HashMap, fs::OpenOptions, os::unix::fs::OpenOptionsExt, time::Duration};
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
        .filter_map(async |value| value)
        .collect()
        .await)
}
pub async fn collect_on(
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
            if let Some(data) = &mut selected
                && let Some(uri) = data.art_uri.take()
            {
                data.art_uri = worker.run(move || local_art(&uri)).await.ok().flatten();
            }
            let value = serde_json::to_value(&selected).expect("serializable media");
            if previous.as_ref() != Some(&value) {
                return Ok(selected);
            }
            let signal =
                tokio::select! {message=changes.next()=>message,message=owners.next()=>message};
            match signal {
                Some(Ok(_)) => {}
                Some(Err(error)) => return Err(error),
                None => return Err(zbus::Error::Failure("media connection closed".into())),
            }
        }
    };
    run.await
        .map_err(|_: zbus::Error| Failure::Unavailable)?
        .ok_or(Failure::NoPlayer)
}
pub async fn collect(
    previous: Option<Value>,
    worker: BlockingWorker,
) -> Result<MediaData, Failure> {
    match Connection::session().await {
        Ok(connection) => collect_on(&connection, previous, worker).await,
        Err(_) => Err(Failure::Unavailable),
    }
}
