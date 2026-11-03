use liquid_widgets_daemon::{
    service::{CollectRequest, Collector, Runtime, Server},
    state::Failure,
    types::ProviderName as P,
    validation::parse_snapshot,
};
use serde_json::{Value, json};
use std::{
    future::Future,
    pin::Pin,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};
struct Counter(AtomicUsize);
impl Collector for Counter {
    fn collect(
        &self,
        _request: CollectRequest,
    ) -> Pin<Box<dyn Future<Output = Result<Value, Failure>> + Send + '_>> {
        Box::pin(async move {
            let n = self.0.fetch_add(1, Ordering::SeqCst) + 1;
            Ok(
                json!({"cpuPercent":n,"memoryUsedBytes":100,"memoryTotalBytes":200,"temperatureC":null}),
            )
        })
    }
}
async fn until(mut predicate: impl AsyncFnMut() -> bool) {
    tokio::time::timeout(Duration::from_secs(3), async {
        while !predicate().await {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("service state did not converge");
}
#[test]
fn ipc_subscription_lifecycle_and_reconnect() {
    if std::env::var("LIQUID_PRIVATE_TEST").is_err() {
        let result = std::process::Command::new("dbus-run-session")
            .args(["--"])
            .arg(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "ipc_subscription_lifecycle_and_reconnect",
                "--nocapture",
            ])
            .env("LIQUID_PRIVATE_TEST", "1")
            .env(
                "LIQUID_PARENT_BUS",
                std::env::var("DBUS_SESSION_BUS_ADDRESS").unwrap_or_default(),
            )
            .status()
            .unwrap();
        assert!(result.success());
        return;
    }
    assert_ne!(
        std::env::var("DBUS_SESSION_BUS_ADDRESS").unwrap(),
        std::env::var("LIQUID_PARENT_BUS").unwrap()
    );
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(async {
            let dir = tempfile::tempdir().unwrap();
            let counter = Arc::new(Counter(AtomicUsize::new(0)));
            let runtime = Runtime::new(
                dir.path().join("config"),
                dir.path().join("cache"),
                counter.clone(),
            )
            .await
            .unwrap();
            let server = Server::start(runtime.clone()).await.unwrap();
            let connection = zbus::Connection::session().await.unwrap();
            let proxy = zbus::Proxy::new(
                &connection,
                "org.local.LiquidWidgets",
                "/org/local/LiquidWidgets",
                "org.local.LiquidWidgets1",
            )
            .await
            .unwrap();
            let snapshot: String = proxy.call("GetSnapshot", &()).await.unwrap();
            parse_snapshot(&snapshot).unwrap();
            tokio::time::sleep(Duration::from_millis(60)).await;
            assert_eq!(counter.0.load(Ordering::SeqCst), 0);
            let first: String = proxy.call("Subscribe", &(vec!["system"],)).await.unwrap();
            let second: String = proxy.call("Subscribe", &(vec!["system"],)).await.unwrap();
            assert_ne!(first, second);
            until(async || runtime.snapshot().await.unwrap()["system"]["status"] == "ok").await;
            assert!(runtime.active(P::System).await);
            let stranger = zbus::Connection::session().await.unwrap();
            let other = zbus::Proxy::new(
                &stranger,
                "org.local.LiquidWidgets",
                "/org/local/LiquidWidgets",
                "org.local.LiquidWidgets1",
            )
            .await
            .unwrap();
            assert!(other.call::<_, _, ()>("Unsubscribe", &first).await.is_err());
            proxy.call::<_, _, ()>("Unsubscribe", &first).await.unwrap();
            assert!(runtime.active(P::System).await);
            let error = proxy
                .call::<_, _, ()>(
                    "SetCalendarSecret",
                    &"https://calendar.google.com/private-super-secret",
                )
                .await
                .unwrap_err();
            assert!(!error.to_string().contains("private-super-secret"));
            proxy.call::<_, _, ()>("Refresh", &"system").await.unwrap();
            assert!(proxy.call::<_, _, ()>("Refresh", &"system").await.is_err());
            drop(proxy);
            connection.close().await.unwrap();
            until(async || !runtime.active(P::System).await).await;
            let count = counter.0.load(Ordering::SeqCst);
            tokio::time::sleep(Duration::from_millis(100)).await;
            assert_eq!(counter.0.load(Ordering::SeqCst), count);
            drop(other);
            stranger.close().await.unwrap();
            server.shutdown().await.unwrap();
            let runtime2 = Runtime::new(
                dir.path().join("config"),
                dir.path().join("cache"),
                counter.clone(),
            )
            .await
            .unwrap();
            let cached = runtime2.snapshot().await.unwrap();
            assert_eq!(cached["system"]["status"], "stale");
            assert!(!cached["system"]["data"].is_null());
            assert_eq!(cached["revisions"]["system"], 0);
            let second_server = Server::start(runtime2.clone()).await.unwrap();
            let connection = zbus::Connection::session().await.unwrap();
            let proxy = zbus::Proxy::new(
                &connection,
                "org.local.LiquidWidgets",
                "/org/local/LiquidWidgets",
                "org.local.LiquidWidgets1",
            )
            .await
            .unwrap();
            let _: String = proxy.call("Subscribe", &(vec!["system"],)).await.unwrap();
            until(async || runtime2.snapshot().await.unwrap()["system"]["status"] == "ok").await;
            assert!(counter.0.load(Ordering::SeqCst) > count);
            drop(proxy);
            connection.close().await.unwrap();
            second_server.shutdown().await.unwrap();
        });
}

struct Delayed(
    tokio::sync::mpsc::UnboundedSender<(
        CollectRequest,
        tokio::sync::oneshot::Sender<Result<Value, Failure>>,
    )>,
);
impl Collector for Delayed {
    fn collect(
        &self,
        request: CollectRequest,
    ) -> Pin<Box<dyn Future<Output = Result<Value, Failure>> + Send + '_>> {
        Box::pin(async move {
            let (tx, rx) = tokio::sync::oneshot::channel();
            self.0.send((request, tx)).unwrap();
            rx.await.unwrap_or(Err(Failure::Unavailable))
        })
    }
}
#[test]
fn ipc_old_source_response_is_discarded_and_new_source_never_reads_old_cache() {
    if std::env::var("LIQUID_PRIVATE_TEST").is_err() {
        let result = std::process::Command::new("dbus-run-session")
            .arg("--")
            .arg(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "ipc_old_source_response_is_discarded_and_new_source_never_reads_old_cache",
                "--nocapture",
            ])
            .env("LIQUID_PRIVATE_TEST", "1")
            .env(
                "LIQUID_PARENT_BUS",
                std::env::var("DBUS_SESSION_BUS_ADDRESS").unwrap_or_default(),
            )
            .status()
            .unwrap();
        assert!(result.success());
        return;
    }
    assert_ne!(
        std::env::var("DBUS_SESSION_BUS_ADDRESS").unwrap(),
        std::env::var("LIQUID_PARENT_BUS").unwrap()
    );
    tokio::runtime::Builder::new_multi_thread().enable_all().build().unwrap().block_on(async {
  let dir=tempfile::tempdir().unwrap();let (tx,mut jobs)=tokio::sync::mpsc::unbounded_channel();let collector=Arc::new(Delayed(tx));
  let runtime=Runtime::new(dir.path().join("config"),dir.path().join("cache"),collector.clone()).await.unwrap();
  let server=Server::start(runtime.clone()).await.unwrap();
  let connection=zbus::Connection::session().await.unwrap();let proxy=zbus::Proxy::new(&connection,"org.local.LiquidWidgets","/org/local/LiquidWidgets","org.local.LiquidWidgets1").await.unwrap();
  let _:String=proxy.call("Subscribe",&(vec!["network"],)).await.unwrap();
  let (first,reply)=tokio::time::timeout(Duration::from_secs(2),jobs.recv()).await.unwrap().unwrap();
  reply.send(Ok(json!({"interface":"old-nic","rxBytesPerSec":10,"txBytesPerSec":20,"history":[]}))).unwrap();
  until(async ||runtime.snapshot().await.unwrap()["network"]["status"]=="ok").await;
  proxy.call::<_,_,()>("Refresh",&"network").await.unwrap();
  let (_,late)=tokio::time::timeout(Duration::from_secs(2),jobs.recv()).await.unwrap().unwrap();
  proxy.call::<_,_,()>("SetNetworkInterface",&"lo").await.unwrap();
  let cleared=runtime.snapshot().await.unwrap();assert_ne!(cleared["network"]["sourceId"],first.ticket.source_id);assert!(cleared["network"]["data"].is_null());
  let _=late.send(Ok(json!({"interface":"old-nic","rxBytesPerSec":999,"txBytesPerSec":999,"history":[]})));
  tokio::time::sleep(Duration::from_millis(50)).await;
  assert!(runtime.snapshot().await.unwrap()["network"]["data"].is_null());
  drop(proxy);connection.close().await.unwrap();server.shutdown().await.unwrap();
  let restarted=Runtime::new(dir.path().join("config"),dir.path().join("cache"),collector).await.unwrap();
  assert!(restarted.snapshot().await.unwrap()["network"]["data"].is_null());
  assert_eq!(restarted.snapshot().await.unwrap()["network"]["sourceId"],cleared["network"]["sourceId"]);
 });
}
