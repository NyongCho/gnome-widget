use liquid_widgets_daemon::cache::{CacheKey, PrivateStore};
use liquid_widgets_daemon::types::ProviderName;
use std::{
    fs,
    os::unix::fs::{PermissionsExt, symlink},
};
#[test]
fn atomic_cache_is_private_and_source_scoped() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("cache");
    let cache = PrivateStore::new(&root).unwrap();
    let a = CacheKey::new(ProviderName::Calendar, "source-a").unwrap();
    let b = CacheKey::new(ProviderName::Calendar, "source-b").unwrap();
    cache.write(&a, b"first").unwrap();
    let held = fs::File::open(cache.path(&a)).unwrap();
    cache.write(&a, b"second").unwrap();
    use std::io::Read;
    let mut old = String::new();
    (&held).read_to_string(&mut old).unwrap();
    assert_eq!(old, "first");
    assert_eq!(cache.read(&a).unwrap().unwrap(), b"second");
    assert_eq!(cache.read(&b).unwrap(), None);
    assert_eq!(
        fs::metadata(&root).unwrap().permissions().mode() & 0o777,
        0o700
    );
    assert_eq!(
        fs::metadata(cache.path(&a)).unwrap().permissions().mode() & 0o777,
        0o600
    );
    assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
}
#[test]
fn invalid_names_symlinks_and_oversized_cache_are_rejected() {
    let temp = tempfile::tempdir().unwrap();
    let cache = PrivateStore::new(&temp.path().join("cache")).unwrap();
    assert!(CacheKey::new(ProviderName::Calendar, "../outside").is_err());
    let key = CacheKey::new(ProviderName::Calendar, "source").unwrap();
    let outside = temp.path().join("outside");
    fs::write(&outside, b"private").unwrap();
    symlink(&outside, cache.path(&key)).unwrap();
    assert!(cache.read(&key).is_err());
    assert!(cache.write(&key, &vec![0; 600 * 1024]).is_err());
    assert_eq!(fs::read(&outside).unwrap(), b"private");
}

#[test]
fn raw_calendar_cache_is_private_bounded_source_specific_and_removed_with_disconnect() {
    use liquid_widgets_daemon::providers::{calendar::MAX_ICS_BYTES, calendar_feed::CalendarCache};
    let root = tempfile::tempdir().unwrap();
    let store = PrivateStore::new(root.path()).unwrap();
    let cached = CalendarCache {
        fetched_at: "2026-11-04T00:00:00Z".into(),
        ics: "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n".into(),
    };
    store.write_calendar("source-a", &cached).unwrap();
    let read = store
        .read_calendar("source-a")
        .unwrap()
        .expect("raw ICS was not persisted");
    assert_eq!(read.ics, cached.ics);
    assert_eq!(read.fetched_at, cached.fetched_at);
    assert!(store.read_calendar("source-b").unwrap().is_none());
    assert!(
        store
            .write_calendar(
                "source-a",
                &CalendarCache {
                    fetched_at: cached.fetched_at.clone(),
                    ics: "x".repeat(MAX_ICS_BYTES + 1)
                }
            )
            .is_err()
    );
    assert_eq!(
        store.read_calendar("source-a").unwrap().unwrap().ics,
        cached.ics
    );
    store
        .remove_provider(liquid_widgets_daemon::types::ProviderName::Calendar)
        .unwrap();
    assert!(store.read_calendar("source-a").unwrap().is_none());
}
