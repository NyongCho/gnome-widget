use liquid_widgets_daemon::{
    http::{FetchFuture, Fetcher},
    providers::media::{Media, local_art, select_player},
    state::{Failure, ServiceState},
    types::{MediaData, PlaybackStatus, ProviderName},
    worker::BlockingWorker,
};
use std::{collections::HashMap, sync::Arc, time::Duration};
struct ArtFixture;
impl Fetcher for ArtFixture {
    fn get(&self, _url: reqwest::Url, _limit: usize) -> FetchFuture<'_> {
        Box::pin(async { Ok(b"fixture art".to_vec()) })
    }
}
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
    art: String,
    title: String,
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
        HashMap::from([
            (
                "xesam:artist".into(),
                zbus::zvariant::Value::from(vec!["fixture artist"])
                    .try_to_owned()
                    .unwrap(),
            ),
            (
                "xesam:title".into(),
                zbus::zvariant::Str::from(self.title.as_str()).into(),
            ),
            (
                "mpris:artUrl".into(),
                zbus::zvariant::Str::from(self.art.as_str()).into(),
            ),
        ])
    }
    #[zbus(property)]
    fn set_metadata(&mut self, metadata: HashMap<String, zbus::zvariant::OwnedValue>) {
        self.title = metadata
            .get("xesam:title")
            .and_then(|value| <&str>::try_from(value).ok())
            .unwrap_or_default()
            .into();
        self.art = metadata
            .get("mpris:artUrl")
            .and_then(|value| <&str>::try_from(value).ok())
            .unwrap_or_default()
            .into();
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
    tokio::runtime::Runtime::new().unwrap().block_on(async {
        let connection = zbus::Connection::session().await.unwrap();
        let worker = BlockingWorker::new(2);
        let root = tempfile::tempdir().unwrap();
        let media = Arc::new(Media::new(
            root.path().join("artwork"),
            Arc::new(ArtFixture),
        ));
        assert_eq!(
            media
                .collect_on(&connection, None, worker.clone())
                .await
                .unwrap_err(),
            Failure::NoPlayer
        );
        let pending = tokio::spawn({
            let media = media.clone();
            let conn = connection.clone();
            let worker = worker.clone();
            async move {
                media
                    .collect_on(&conn, Some(serde_json::Value::Null), worker)
                    .await
            }
        });
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert!(!pending.is_finished());
        let fake = zbus::connection::Builder::session()
            .unwrap()
            .name("org.mpris.MediaPlayer2.test")
            .unwrap()
            .serve_at(
                "/org/mpris/MediaPlayer2",
                FakePlayer {
                    status: "Playing".into(),
                    title: "한글 곡".into(),
                    art: String::new(),
                },
            )
            .unwrap()
            .build()
            .await
            .unwrap();
        let data = tokio::time::timeout(Duration::from_secs(3), pending)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert_eq!(data.title, "한글 곡");
        let pending = tokio::spawn({
            let media = media.clone();
            let conn = connection.clone();
            let worker = worker.clone();
            async move {
                media
                    .collect_on(&conn, Some(serde_json::to_value(data).unwrap()), worker)
                    .await
            }
        });
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert!(!pending.is_finished());
        let proxy = zbus::Proxy::new(
            &connection,
            "org.mpris.MediaPlayer2.test",
            "/org/mpris/MediaPlayer2",
            "org.mpris.MediaPlayer2.Player",
        )
        .await
        .unwrap();
        proxy
            .set_property("PlaybackStatus", "Paused")
            .await
            .unwrap();
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(3), pending)
                .await
                .unwrap()
                .unwrap()
                .unwrap_err(),
            Failure::NoPlayer
        );
        proxy
            .set_property("PlaybackStatus", "Playing")
            .await
            .unwrap();
        let data = media
            .collect_on(&connection, Some(serde_json::Value::Null), worker.clone())
            .await
            .unwrap();
        let pending = tokio::spawn({
            let media = media.clone();
            let conn = connection.clone();
            async move {
                media
                    .collect_on(&conn, Some(serde_json::to_value(data).unwrap()), worker)
                    .await
            }
        });
        tokio::time::sleep(Duration::from_millis(100)).await;
        drop(proxy);
        fake.close().await.unwrap();
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(3), pending)
                .await
                .unwrap()
                .unwrap()
                .unwrap_err(),
            Failure::NoPlayer
        );
    });
}

#[test]
fn remote_mpris_art_is_resolved_to_a_local_file() {
    if std::env::var_os("LIQUID_REMOTE_MEDIA_TEST").is_none() {
        assert!(
            std::process::Command::new("dbus-run-session")
                .arg("--")
                .arg(std::env::current_exe().unwrap())
                .args(["--exact", "remote_mpris_art_is_resolved_to_a_local_file"])
                .env("LIQUID_REMOTE_MEDIA_TEST", "1")
                .status()
                .unwrap()
                .success()
        );
        return;
    }
    tokio::runtime::Runtime::new().unwrap().block_on(async {
        let _fake = zbus::connection::Builder::session()
            .unwrap()
            .name("org.mpris.MediaPlayer2.test")
            .unwrap()
            .serve_at(
                "/org/mpris/MediaPlayer2",
                FakePlayer {
                    status: "Playing".into(),
                    title: "한글 곡".into(),
                    art: "https://i.scdn.co/image/fixture".into(),
                },
            )
            .unwrap()
            .build()
            .await
            .unwrap();
        let connection = zbus::Connection::session().await.unwrap();
        let root = tempfile::tempdir().unwrap();
        let media = Media::new(root.path().join("artwork"), Arc::new(ArtFixture));
        let first = media
            .collect_on(&connection, None, BlockingWorker::new(2))
            .await
            .unwrap();
        assert_eq!(first.title, "한글 곡");
        assert!(
            first.art_uri.is_none(),
            "new track should publish immediately with generic art"
        );
        let data = media
            .collect_on(
                &connection,
                Some(serde_json::to_value(first).unwrap()),
                BlockingWorker::new(2),
            )
            .await
            .unwrap();
        assert_eq!(data.title, "한글 곡");
        let uri = data.art_uri.expect("remote MPRIS artwork was discarded");
        assert!(uri.starts_with("file://"));
        assert_eq!(local_art(&uri), Some(uri.clone()));
        assert_eq!(
            std::fs::read(reqwest::Url::parse(&uri).unwrap().to_file_path().unwrap()).unwrap(),
            b"fixture art"
        );
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

type ArtReply = tokio::sync::oneshot::Sender<Result<Vec<u8>, Failure>>;
struct GatedArt(tokio::sync::mpsc::UnboundedSender<ArtReply>);
impl Fetcher for GatedArt {
    fn get(&self, _url: reqwest::Url, _limit: usize) -> FetchFuture<'_> {
        Box::pin(async move {
            let (send, receive) = tokio::sync::oneshot::channel();
            self.0.send(send).unwrap();
            receive.await.unwrap_or(Err(Failure::Network))
        })
    }
}
fn isolated_session(test: &str) -> bool {
    if std::env::var_os("LIQUID_ART_EVENT_TEST").is_some() {
        return true;
    }
    assert!(
        std::process::Command::new("dbus-run-session")
            .arg("--")
            .arg(std::env::current_exe().unwrap())
            .args(["--exact", test])
            .env("LIQUID_ART_EVENT_TEST", "1")
            .status()
            .unwrap()
            .success()
    );
    false
}
fn metadata(title: &str, art: &str) -> HashMap<String, zbus::zvariant::OwnedValue> {
    HashMap::from([
        (
            "xesam:title".into(),
            zbus::zvariant::Str::from(title).into(),
        ),
        ("mpris:artUrl".into(), zbus::zvariant::Str::from(art).into()),
    ])
}
#[test]
fn artwork_completion_rechecks_current_player_metadata() {
    if !isolated_session("artwork_completion_rechecks_current_player_metadata") {
        return;
    }
    tokio::runtime::Runtime::new().unwrap().block_on(async {
        let fake = zbus::connection::Builder::session()
            .unwrap()
            .name("org.mpris.MediaPlayer2.test")
            .unwrap()
            .serve_at(
                "/org/mpris/MediaPlayer2",
                FakePlayer {
                    status: "Playing".into(),
                    title: "first track".into(),
                    art: "https://example.test/first".into(),
                },
            )
            .unwrap()
            .build()
            .await
            .unwrap();
        let connection = zbus::Connection::session().await.unwrap();
        let root = tempfile::tempdir().unwrap();
        let (send, mut requests) = tokio::sync::mpsc::unbounded_channel();
        let media = Arc::new(Media::new(
            root.path().join("artwork"),
            Arc::new(GatedArt(send)),
        ));
        let worker = BlockingWorker::new(2);
        let first = media
            .collect_on(&connection, None, worker.clone())
            .await
            .unwrap();
        let pending = tokio::spawn({
            let media = media.clone();
            let conn = connection.clone();
            async move {
                media
                    .collect_on(&conn, Some(serde_json::to_value(first).unwrap()), worker)
                    .await
            }
        });
        let reply = tokio::time::timeout(Duration::from_secs(1), requests.recv())
            .await
            .unwrap()
            .unwrap();
        // Change the real D-Bus object before its signal arrives. A download's
        // completion must validate the player again, not trust its old snapshot.
        let interface = fake
            .object_server()
            .interface::<_, FakePlayer>("/org/mpris/MediaPlayer2")
            .await
            .unwrap();
        {
            let mut state = interface.get_mut().await;
            state.title = "current track".into();
            state.art.clear();
        }
        reply.send(Ok(b"old artwork".to_vec())).unwrap();
        let data = tokio::time::timeout(Duration::from_secs(1), pending)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert_eq!(
            data.title, "current track",
            "finished download published obsolete metadata"
        );
        assert!(
            data.art_uri.is_none(),
            "old artwork leaked into the new track"
        );
    });
}
#[test]
fn track_pause_owner_and_collection_cancellation_drop_pending_artwork() {
    if !isolated_session("track_pause_owner_and_collection_cancellation_drop_pending_artwork") {
        return;
    }
    tokio::runtime::Runtime::new().unwrap().block_on(async {
        for change in ["track", "pause", "owner", "cancel", "switch"] {
            let fake = zbus::connection::Builder::session()
                .unwrap()
                .name("org.mpris.MediaPlayer2.test")
                .unwrap()
                .serve_at(
                    "/org/mpris/MediaPlayer2",
                    FakePlayer {
                        status: "Playing".into(),
                        title: "first track".into(),
                        art: "https://example.test/first".into(),
                    },
                )
                .unwrap()
                .build()
                .await
                .unwrap();
            let connection = zbus::Connection::session().await.unwrap();
            let root = tempfile::tempdir().unwrap();
            let (send, mut requests) = tokio::sync::mpsc::unbounded_channel();
            let media = Arc::new(Media::new(
                root.path().join("artwork"),
                Arc::new(GatedArt(send)),
            ));
            let worker = BlockingWorker::new(2);
            let first = media
                .collect_on(&connection, None, worker.clone())
                .await
                .unwrap();
            assert_eq!(first.artist, "fixture artist");
            assert!(first.art_uri.is_none());
            let pending = tokio::spawn({
                let media = media.clone();
                let conn = connection.clone();
                async move {
                    media
                        .collect_on(&conn, Some(serde_json::to_value(first).unwrap()), worker)
                        .await
                }
            });
            let mut reply = tokio::time::timeout(Duration::from_secs(1), requests.recv())
                .await
                .unwrap()
                .unwrap();
            let proxy = zbus::Proxy::new(
                &connection,
                "org.mpris.MediaPlayer2.test",
                "/org/mpris/MediaPlayer2",
                "org.mpris.MediaPlayer2.Player",
            )
            .await
            .unwrap();
            let mut replacement = None;
            match change {
                "track" => proxy
                    .set_property(
                        "Metadata",
                        metadata("current track", "https://example.test/current"),
                    )
                    .await
                    .unwrap(),
                "pause" => proxy
                    .set_property("PlaybackStatus", "Paused")
                    .await
                    .unwrap(),
                "owner" => fake.clone().close().await.unwrap(),
                "cancel" => pending.abort(),
                "switch" => {
                    replacement = Some(
                        zbus::connection::Builder::session()
                            .unwrap()
                            .name("org.mpris.MediaPlayer2.aaa")
                            .unwrap()
                            .serve_at(
                                "/org/mpris/MediaPlayer2",
                                FakePlayer {
                                    status: "Playing".into(),
                                    title: "current track".into(),
                                    art: String::new(),
                                },
                            )
                            .unwrap()
                            .build()
                            .await
                            .unwrap(),
                    )
                }
                _ => unreachable!(),
            }
            let result = tokio::time::timeout(Duration::from_secs(1), pending)
                .await
                .unwrap();
            if change == "cancel" {
                assert!(result.unwrap_err().is_cancelled());
            } else if change == "track" || change == "switch" {
                let data = result.unwrap().unwrap();
                assert_eq!(data.title, "current track");
                assert_eq!(data.artist, "fixture artist");
                assert!(data.art_uri.is_none());
            } else {
                assert_eq!(result.unwrap().unwrap_err(), Failure::NoPlayer);
            }
            tokio::time::timeout(Duration::from_secs(1), reply.closed())
                .await
                .unwrap();
            assert!(reply.send(Ok(b"late art".to_vec())).is_err());
            assert_eq!(
                std::fs::read_dir(root.path().join("artwork"))
                    .unwrap()
                    .count(),
                0
            );
            drop(proxy);
            if let Some(replacement) = replacement {
                replacement.close().await.unwrap();
            }
            fake.close().await.unwrap();
        }
    });
}
#[test]
fn artwork_failure_preserves_title_artist_and_generic_art() {
    if !isolated_session("artwork_failure_preserves_title_artist_and_generic_art") {
        return;
    }
    tokio::runtime::Runtime::new().unwrap().block_on(async {
        let _fake = zbus::connection::Builder::session()
            .unwrap()
            .name("org.mpris.MediaPlayer2.test")
            .unwrap()
            .serve_at(
                "/org/mpris/MediaPlayer2",
                FakePlayer {
                    status: "Playing".into(),
                    title: "current track".into(),
                    art: "https://example.test/missing".into(),
                },
            )
            .unwrap()
            .build()
            .await
            .unwrap();
        let connection = zbus::Connection::session().await.unwrap();
        let root = tempfile::tempdir().unwrap();
        let (send, mut requests) = tokio::sync::mpsc::unbounded_channel();
        let media = Arc::new(Media::new(
            root.path().join("artwork"),
            Arc::new(GatedArt(send)),
        ));
        let worker = BlockingWorker::new(2);
        let initial = media
            .collect_on(&connection, None, worker.clone())
            .await
            .unwrap();
        let pending = tokio::spawn({
            let media = media.clone();
            let conn = connection.clone();
            let initial = initial.clone();
            let worker = worker.clone();
            async move {
                media
                    .collect_on(&conn, Some(serde_json::to_value(initial).unwrap()), worker)
                    .await
            }
        });
        requests
            .recv()
            .await
            .unwrap()
            .send(Err(Failure::Auth))
            .unwrap();
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert!(
            !pending.is_finished(),
            "art failure must not replace a valid media payload with an error"
        );
        pending.abort();
        let _ = pending.await;
        let data = media.collect_on(&connection, None, worker).await.unwrap();
        assert_eq!(data.title, "current track");
        assert_eq!(data.artist, "fixture artist");
        assert!(data.art_uri.is_none());
        assert_eq!(
            std::fs::read_dir(root.path().join("artwork"))
                .unwrap()
                .count(),
            0
        );
    });
}

#[test]
fn downloaded_art_waits_for_busy_workers_without_refetching() {
    if !isolated_session("downloaded_art_waits_for_busy_workers_without_refetching") {
        return;
    }
    tokio::runtime::Runtime::new().unwrap().block_on(async {
        let _fake = zbus::connection::Builder::session()
            .unwrap()
            .name("org.mpris.MediaPlayer2.test")
            .unwrap()
            .serve_at(
                "/org/mpris/MediaPlayer2",
                FakePlayer {
                    status: "Playing".into(),
                    title: "current track".into(),
                    art: "https://example.test/cover".into(),
                },
            )
            .unwrap()
            .build()
            .await
            .unwrap();
        let connection = zbus::Connection::session().await.unwrap();
        let root = tempfile::tempdir().unwrap();
        let (send, mut requests) = tokio::sync::mpsc::unbounded_channel();
        let media = Arc::new(Media::new(
            root.path().join("artwork"),
            Arc::new(GatedArt(send)),
        ));
        let worker = BlockingWorker::new(2);
        let initial = media
            .collect_on(&connection, None, worker.clone())
            .await
            .unwrap();
        let pending = tokio::spawn({
            let media = media.clone();
            let conn = connection.clone();
            let worker = worker.clone();
            async move {
                media
                    .collect_on(&conn, Some(serde_json::to_value(initial).unwrap()), worker)
                    .await
            }
        });
        let reply = tokio::time::timeout(Duration::from_secs(1), requests.recv())
            .await
            .unwrap()
            .unwrap();
        let mut busy = Vec::new();
        for _ in 0..2 {
            let (release, wait) = std::sync::mpsc::channel();
            let (started, ready) = tokio::sync::oneshot::channel();
            let worker = worker.clone();
            let task = tokio::spawn(async move {
                worker
                    .run(move || {
                        started.send(()).unwrap();
                        wait.recv_timeout(Duration::from_secs(3)).unwrap();
                    })
                    .await
                    .unwrap();
            });
            ready.await.unwrap();
            busy.push((release, task));
        }
        reply.send(Ok(b"downloaded artwork".to_vec())).unwrap();
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert!(!pending.is_finished());
        for (release, task) in busy {
            release.send(()).unwrap();
            task.await.unwrap();
        }
        let data = tokio::time::timeout(Duration::from_secs(1), pending)
            .await
            .expect("successful artwork was discarded while the disk workers were busy")
            .unwrap()
            .unwrap();
        assert_eq!(data.title, "current track");
        let uri = data.art_uri.expect("downloaded artwork was lost");
        assert_eq!(
            std::fs::read(reqwest::Url::parse(&uri).unwrap().to_file_path().unwrap()).unwrap(),
            b"downloaded artwork"
        );
        assert!(
            requests.try_recv().is_err(),
            "worker contention must not repeat HTTP"
        );
    });
}
