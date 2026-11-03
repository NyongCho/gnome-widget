use liquid_widgets_daemon::{
    providers::media::{collect_on, local_art, select_player},
    state::{Failure, ServiceState},
    types::{MediaData, PlaybackStatus, ProviderName},
    worker::BlockingWorker,
};
use std::{collections::HashMap, time::Duration};
fn player(name: &str, status: PlaybackStatus) -> MediaData {
    MediaData {
        player: name.into(),
        status,
        title: "한글 곡".into(),
        artist: "테스트".into(),
        art_uri: None,
    }
}
#[test]
fn mpris_selects_playing_player() {
    let chosen = select_player(vec![
        player("org.mpris.MediaPlayer2.z", PlaybackStatus::Playing),
        player("org.mpris.MediaPlayer2.b", PlaybackStatus::Playing),
        player("org.mpris.MediaPlayer2.a", PlaybackStatus::Paused),
    ])
    .unwrap();
    assert_eq!(chosen.player, "org.mpris.MediaPlayer2.b");
}
#[test]
fn paused_players_hide_card() {
    assert!(
        select_player(vec![
            player("a", PlaybackStatus::Paused),
            player("b", PlaybackStatus::Stopped)
        ])
        .is_none()
    );
    let mut state = ServiceState::new();
    let ticket = state.begin(ProviderName::Media);
    state
        .finish(
            &ticket,
            Ok(serde_json::to_value(player("a", PlaybackStatus::Playing)).unwrap()),
        )
        .unwrap();
    state.finish(&ticket, Err(Failure::NoPlayer)).unwrap();
    assert!(state.provider(ProviderName::Media)["data"].is_null());
    assert_eq!(
        state.provider(ProviderName::Media)["errorCode"],
        "NO_PLAYER"
    );
}
#[test]
fn only_readable_local_art_is_accepted() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("cover.png");
    std::fs::write(&path, b"local art").unwrap();
    let uri = reqwest::Url::from_file_path(&path).unwrap().to_string();
    assert_eq!(local_art(&uri), Some(uri));
    assert_eq!(local_art("https://example.org/art.png"), None);
    assert_eq!(local_art("file:///does-not-exist.png"), None);
    assert_eq!(
        local_art(reqwest::Url::from_file_path(root.path()).unwrap().as_ref()),
        None
    );
}
struct FakePlayer {
    status: String,
}
#[zbus::interface(name = "org.mpris.MediaPlayer2.Player")]
impl FakePlayer {
    #[zbus(property)]
    fn playback_status(&self) -> &str {
        &self.status
    }
    #[zbus(property)]
    fn set_playback_status(&mut self, status: String) {
        self.status = status;
    }
    #[zbus(property)]
    fn metadata(&self) -> HashMap<String, zbus::zvariant::OwnedValue> {
        HashMap::from([(
            "xesam:title".into(),
            zbus::zvariant::Str::from("한글 곡").into(),
        )])
    }
}
#[test]
fn property_and_owner_events_update_without_polling() {
    if std::env::var_os("LIQUID_MEDIA_TEST").is_none() {
        assert!(
            std::process::Command::new("dbus-run-session")
                .arg("--")
                .arg(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "property_and_owner_events_update_without_polling"
                ])
                .env("LIQUID_MEDIA_TEST", "1")
                .status()
                .unwrap()
                .success()
        );
        return;
    }
    tokio::runtime::Runtime::new().unwrap().block_on(async{
  let connection=zbus::Connection::session().await.unwrap();let worker=BlockingWorker::new(2);
  assert_eq!(collect_on(&connection,None,worker.clone()).await.unwrap_err(),Failure::NoPlayer);
  let pending=tokio::spawn({let conn=connection.clone();let worker=worker.clone();async move{collect_on(&conn,Some(serde_json::Value::Null),worker).await}});
  tokio::time::sleep(Duration::from_millis(100)).await;assert!(!pending.is_finished());
  let fake=zbus::connection::Builder::session().unwrap().name("org.mpris.MediaPlayer2.test").unwrap().serve_at("/org/mpris/MediaPlayer2",FakePlayer{status:"Playing".into()}).unwrap().build().await.unwrap();
  let data=tokio::time::timeout(Duration::from_secs(3),pending).await.unwrap().unwrap().unwrap();assert_eq!(data.title,"한글 곡");
  let pending=tokio::spawn({let conn=connection.clone();let worker=worker.clone();async move{collect_on(&conn,Some(serde_json::to_value(data).unwrap()),worker).await}});
  tokio::time::sleep(Duration::from_millis(100)).await;assert!(!pending.is_finished());
  let proxy=zbus::Proxy::new(&connection,"org.mpris.MediaPlayer2.test","/org/mpris/MediaPlayer2","org.mpris.MediaPlayer2.Player").await.unwrap();proxy.set_property("PlaybackStatus","Paused").await.unwrap();
  assert_eq!(tokio::time::timeout(Duration::from_secs(3),pending).await.unwrap().unwrap().unwrap_err(),Failure::NoPlayer);
  proxy.set_property("PlaybackStatus","Playing").await.unwrap();let data=collect_on(&connection,Some(serde_json::Value::Null),worker.clone()).await.unwrap();
  let pending=tokio::spawn({let conn=connection.clone();async move{collect_on(&conn,Some(serde_json::to_value(data).unwrap()),worker).await}});
  tokio::time::sleep(Duration::from_millis(100)).await;drop(proxy);fake.close().await.unwrap();
  assert_eq!(tokio::time::timeout(Duration::from_secs(3),pending).await.unwrap().unwrap().unwrap_err(),Failure::NoPlayer);
 });
}

#[test]
fn non_regular_art_cannot_block_collection() {
    use std::os::unix::ffi::OsStrExt;
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("pipe");
    let cpath = std::ffi::CString::new(path.as_os_str().as_bytes()).unwrap();
    // SAFETY: valid NUL-terminated path in a test-owned temporary directory.
    assert_eq!(unsafe { libc::mkfifo(cpath.as_ptr(), 0o600) }, 0);
    let uri = reqwest::Url::from_file_path(&path).unwrap().to_string();
    let (send, receive) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        send.send(local_art(&uri)).unwrap();
    });
    assert_eq!(
        receive
            .recv_timeout(Duration::from_secs(1))
            .expect("artwork pipe blocked the worker"),
        None
    );
}
