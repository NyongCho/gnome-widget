use liquid_widgets_daemon::{
    cache::{CacheKey, PrivateStore},
    config::Config,
    secrets::{SecretError, SecretFuture, SecretStore, validate_calendar_url},
    service::{Runtime, UnavailableCollector},
    types::ProviderName as P,
};
use std::{
    collections::BTreeMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};
const URL: &str = "https://calendar.google.com/calendar/ical/example%40gmail.com/private-sensitive-token/basic.ics";
#[derive(Default)]
struct FakeSecrets {
    values: Mutex<BTreeMap<String, String>>,
    locked: AtomicBool,
}
impl SecretStore for FakeSecrets {
    fn read(&self, source: String) -> SecretFuture<'_, String> {
        Box::pin(async move {
            if self.locked.load(Ordering::SeqCst) {
                return Err(SecretError);
            }
            self.values
                .lock()
                .unwrap()
                .get(&source)
                .cloned()
                .ok_or(SecretError)
        })
    }
    fn write(&self, source: String, url: String) -> SecretFuture<'_, ()> {
        Box::pin(async move {
            if self.locked.load(Ordering::SeqCst) {
                return Err(SecretError);
            }
            self.values.lock().unwrap().insert(source, url);
            Ok(())
        })
    }
    fn delete(&self, source: Option<String>) -> SecretFuture<'_, ()> {
        Box::pin(async move {
            if self.locked.load(Ordering::SeqCst) {
                return Err(SecretError);
            }
            let mut values = self.values.lock().unwrap();
            if let Some(source) = source {
                values.remove(&source);
            } else {
                values.clear();
            }
            Ok(())
        })
    }
}
#[test]
fn calendar_url_accepts_only_google_https_ical_without_credentials() {
    assert!(validate_calendar_url(URL).is_ok());
    for value in [
        "http://calendar.google.com/calendar/ical/x/private-x/basic.ics",
        "https://calendar.google.com.evil.test/calendar/ical/x/private-x/basic.ics",
        "https://calendar.google.com/calendar/u/0/",
        "https://user:pass@calendar.google.com/calendar/ical/x/private-x/basic.ics",
        "https://calendar.google.com/calendar/ical/x/private-x/basic.ics?leak=secret",
    ] {
        let err = validate_calendar_url(value).unwrap_err();
        assert!(!err.to_string().contains(value));
    }
}
#[tokio::test]
async fn disconnect_removes_events_and_cache_even_when_keyring_delete_fails() {
    let dir = tempfile::tempdir().unwrap();
    let config = dir.path().join("config");
    let cache = dir.path().join("cache");
    let secrets = Arc::new(FakeSecrets::default());
    let runtime = Runtime::new_with_secrets(
        config.clone(),
        cache.clone(),
        Arc::new(UnavailableCollector),
        secrets.clone(),
    )
    .await
    .unwrap();
    runtime.set_calendar_secret(URL.into()).await.unwrap();
    let settings = runtime.settings_json().await.unwrap();
    assert!(settings.contains("\"calendarEnabled\":true"));
    assert!(!settings.contains("sensitive-token"));
    let conf = Config::load(&PrivateStore::new(&config).unwrap()).unwrap();
    let key = CacheKey::new(P::Calendar, &conf.sources[&P::Calendar]).unwrap();
    let store = PrivateStore::new(&cache).unwrap();
    store.write(&key, b"old private events").unwrap();
    secrets.locked.store(true, Ordering::SeqCst);
    assert!(runtime.clear_calendar_secret().await.is_err());
    let state = runtime.snapshot().await.unwrap();
    assert_eq!(state["calendar"]["status"], "unconfigured");
    assert!(state["calendar"]["data"].is_null());
    assert!(!store.path(&key).exists());
    let settings = runtime.settings_json().await.unwrap();
    assert!(settings.contains("\"calendarEnabled\":false"));
    assert!(settings.contains("\"calendarSecretDeletionPending\":true"));
    let restarted = Runtime::new_with_secrets(
        config,
        cache,
        Arc::new(UnavailableCollector),
        secrets.clone(),
    )
    .await
    .unwrap();
    assert!(restarted.snapshot().await.unwrap()["calendar"]["data"].is_null());
    secrets.locked.store(false, Ordering::SeqCst);
    restarted.clear_calendar_secret().await.unwrap();
    assert!(secrets.values.lock().unwrap().is_empty());
    assert!(
        restarted
            .settings_json()
            .await
            .unwrap()
            .contains("\"calendarSecretDeletionPending\":false")
    );
}
#[tokio::test]
async fn failed_secret_store_preserves_previous_source_and_never_persists_url() {
    let dir = tempfile::tempdir().unwrap();
    let config = dir.path().join("config");
    let cache = dir.path().join("cache");
    let secrets = Arc::new(FakeSecrets::default());
    let runtime = Runtime::new_with_secrets(
        config.clone(),
        cache.clone(),
        Arc::new(UnavailableCollector),
        secrets.clone(),
    )
    .await
    .unwrap();
    runtime.set_calendar_secret(URL.into()).await.unwrap();
    let before = runtime.snapshot().await.unwrap()["calendar"]["sourceId"].clone();
    secrets.locked.store(true, Ordering::SeqCst);
    let error = runtime
        .set_calendar_secret(URL.replace("sensitive-token", "other-secret"))
        .await
        .unwrap_err();
    assert!(!error.to_string().contains("other-secret"));
    assert_eq!(
        before,
        runtime.snapshot().await.unwrap()["calendar"]["sourceId"]
    );
    let text = std::fs::read_to_string(config.join("settings.toml")).unwrap();
    assert!(!text.contains("private-sensitive-token"));
    secrets.locked.store(false, Ordering::SeqCst);
    runtime
        .set_calendar_secret(URL.replace("sensitive-token", "other-secret"))
        .await
        .unwrap();
    assert_ne!(
        before,
        runtime.snapshot().await.unwrap()["calendar"]["sourceId"]
    );
    assert_eq!(secrets.values.lock().unwrap().len(), 1);
}

#[test]
fn real_keyring_adapter_uses_isolated_collection_and_handles_lock() {
    if std::env::var_os("LIQUID_KEYRING_TEST").is_none() {
        let dir = tempfile::tempdir().unwrap();
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
        let result = std::process::Command::new("dbus-run-session")
            .arg("--")
            .arg(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "real_keyring_adapter_uses_isolated_collection_and_handles_lock",
                "--nocapture",
            ])
            .env("LIQUID_KEYRING_TEST", dir.path())
            .env("XDG_RUNTIME_DIR", dir.path())
            .env_remove("GNOME_KEYRING_CONTROL")
            .env("XDG_DATA_HOME", dir.path().join("data"))
            .env("XDG_CONFIG_HOME", dir.path().join("config"))
            .env("XDG_CACHE_HOME", dir.path().join("cache"))
            .status()
            .unwrap();
        assert!(result.success());
        return;
    }
    use std::io::Write;
    let path = std::path::PathBuf::from(std::env::var_os("LIQUID_KEYRING_TEST").unwrap());
    let control = path.join("control");
    std::fs::create_dir_all(&control).unwrap();
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(&control, std::fs::Permissions::from_mode(0o700)).unwrap();
    let mut daemon = std::process::Command::new("gnome-keyring-daemon")
        .args([
            "--foreground",
            "--unlock",
            "--components=secrets",
            "--control-directory",
        ])
        .arg(control)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::null())
        .spawn()
        .unwrap();
    daemon
        .stdin
        .take()
        .unwrap()
        .write_all(b"liquid-widgets-test-fixture")
        .unwrap();
    struct Stop(std::process::Child);
    impl Drop for Stop {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
    let _stop = Stop(daemon);
    tokio::runtime::Runtime::new().unwrap().block_on(async {
        let store = liquid_widgets_daemon::secrets::SystemSecrets;
        let mut ready = false;
        for _ in 0..30 {
            if store.write("fixture".into(), URL.into()).await.is_ok() {
                ready = true;
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
        assert!(ready, "isolated keyring did not become available");
        assert_eq!(store.read("fixture".into()).await.unwrap(), URL);
        let mut clear = std::process::Command::new(env!("CARGO_BIN_EXE_liquid-widgets-daemon"))
            .arg("--clear-calendar")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .unwrap();
        let mut result = None;
        for _ in 0..100 {
            if let Some(status) = clear.try_wait().unwrap() {
                result = Some(status);
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        if result.is_none() {
            clear.kill().unwrap();
            clear.wait().unwrap();
        }
        assert!(
            result.is_some_and(|status| status.success()),
            "clear-calendar command must exit successfully"
        );
        assert!(store.read("fixture".into()).await.is_err());
        store.write("fixture".into(), URL.into()).await.unwrap();
        let service = secret_service::SecretService::connect(secret_service::EncryptionType::Dh)
            .await
            .unwrap();
        service
            .get_default_collection()
            .await
            .unwrap()
            .lock()
            .await
            .unwrap();
        assert!(store.read("fixture".into()).await.is_err());
        assert!(store.delete(None).await.is_err());
        let status = std::process::Command::new(env!("CARGO_BIN_EXE_liquid-widgets-daemon"))
            .arg("--clear-calendar")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .unwrap();
        assert!(
            !status.success(),
            "locked keyring must not report purge complete"
        );
    });
}

#[tokio::test]
async fn reconnect_preserves_pending_cleanup_until_all_app_secrets_are_deleted() {
    let dir = tempfile::tempdir().unwrap();
    let secrets = Arc::new(FakeSecrets::default());
    let runtime = Runtime::new_with_secrets(
        dir.path().join("config"),
        dir.path().join("cache"),
        Arc::new(UnavailableCollector),
        secrets.clone(),
    )
    .await
    .unwrap();
    runtime.set_calendar_secret(URL.into()).await.unwrap();
    secrets.locked.store(true, Ordering::SeqCst);
    assert!(runtime.clear_calendar_secret().await.is_err());
    secrets.locked.store(false, Ordering::SeqCst);
    runtime
        .set_calendar_secret(URL.replace("sensitive-token", "new-token"))
        .await
        .unwrap();
    assert_eq!(secrets.values.lock().unwrap().len(), 2);
    assert!(
        runtime
            .settings_json()
            .await
            .unwrap()
            .contains("\"calendarSecretDeletionPending\":true")
    );
    runtime
        .set_calendar_secret(URL.replace("sensitive-token", "third-token"))
        .await
        .unwrap();
    assert_eq!(secrets.values.lock().unwrap().len(), 2);
    assert!(
        runtime
            .settings_json()
            .await
            .unwrap()
            .contains("\"calendarSecretDeletionPending\":true")
    );
    runtime.clear_calendar_secret().await.unwrap();
    assert!(secrets.values.lock().unwrap().is_empty());
    assert!(
        runtime
            .settings_json()
            .await
            .unwrap()
            .contains("\"calendarSecretDeletionPending\":false")
    );
}
