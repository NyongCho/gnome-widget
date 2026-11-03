//! Session-bus service. Provider collection is injected; network/keyring providers arrive later.
use crate::{
    cache::{CacheKey, PrivateStore},
    config::Config,
    state::{Failure, ServiceState, Ticket},
    types::{CalendarContext, ProviderName, WeatherLocation},
    validation,
};
use futures_util::StreamExt;
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    future::Future,
    path::PathBuf,
    pin::Pin,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::{
    sync::{Mutex, broadcast, watch},
    task::JoinHandle,
};
const NAME: &str = "org.local.LiquidWidgets";
const PATH: &str = "/org/local/LiquidWidgets";
const IFACE: &str = "org.local.LiquidWidgets1";
#[derive(Debug, thiserror::Error)]
#[error("local service operation failed")]
pub struct ServiceError;
#[derive(Clone)]
pub struct CollectRequest {
    pub ticket: Ticket,
    pub config: Config,
    pub blocking: crate::worker::BlockingWorker,
    pub calendar_cache: Option<crate::providers::calendar_feed::CalendarCache>,
}
pub struct Collected {
    pub data: Value,
    pub updated_at: Option<String>,
    pub stale: Option<Failure>,
    pub calendar_cache: Option<crate::providers::calendar_feed::CalendarCache>,
}
impl From<Value> for Collected {
    fn from(data: Value) -> Self {
        Self {
            data,
            updated_at: None,
            stale: None,
            calendar_cache: None,
        }
    }
}
pub trait Collector: Send + Sync {
    fn search_locations(
        &self,
        _query: String,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<WeatherLocation>, Failure>> + Send + '_>> {
        Box::pin(async { Err(Failure::Unavailable) })
    }
    fn collect(
        &self,
        request: CollectRequest,
    ) -> Pin<Box<dyn Future<Output = Result<Collected, Failure>> + Send + '_>>;
}
/// Explicit unavailable states until the real provider implementations are installed.
pub struct UnavailableCollector;
impl Collector for UnavailableCollector {
    fn collect(
        &self,
        _request: CollectRequest,
    ) -> Pin<Box<dyn Future<Output = Result<Collected, Failure>> + Send + '_>> {
        Box::pin(async { Err(Failure::Unavailable) })
    }
}
#[derive(Clone, Debug)]
pub struct Change {
    pub provider: ProviderName,
    pub revision: u32,
    pub payload: String,
}
#[derive(Clone, Copy, Default, PartialEq, Eq)]
struct Control {
    active: bool,
    epoch: u64,
}
struct Subscription {
    sender: String,
    providers: BTreeSet<ProviderName>,
}
struct Inner {
    state: ServiceState,
    config: Config,
    subscriptions: BTreeMap<String, Subscription>,
    refresh: BTreeMap<ProviderName, Instant>,
}
pub struct Runtime {
    inner: Mutex<Inner>,
    config_store: PrivateStore,
    cache: PrivateStore,
    collector: Arc<dyn Collector>,
    secrets: Arc<dyn crate::secrets::SecretStore>,
    calendar_admin: Mutex<()>,
    search_gate: Mutex<Option<Instant>>,
    blocking: crate::worker::BlockingWorker,
    controls: BTreeMap<ProviderName, watch::Sender<Control>>,
    changes: broadcast::Sender<Change>,
}
pub enum SettingChange {
    Context(CalendarContext),
    Weather(Option<WeatherLocation>),
    Network(String),
}
impl Runtime {
    pub async fn new(
        config: PathBuf,
        cache: PathBuf,
        collector: Arc<dyn Collector>,
    ) -> Result<Arc<Self>, ServiceError> {
        Self::new_with_secrets(
            config,
            cache,
            collector,
            Arc::new(crate::secrets::NoSecrets),
        )
        .await
    }
    pub async fn set_calendar_secret(&self, url: String) -> Result<(), ServiceError> {
        crate::secrets::validate_calendar_url(&url).map_err(|_| ServiceError)?;
        let _admin = self.calendar_admin.lock().await;
        let source = uuid::Uuid::new_v4().to_string();
        self.secrets
            .write(source.clone(), url)
            .await
            .map_err(|_| ServiceError)?;
        let mut inner = self.inner.lock().await;
        let mut next = inner.config.clone();
        let old = next.sources[&ProviderName::Calendar].clone();
        next.settings.calendar_enabled = true;
        next.settings.calendar_secret_deletion_pending = false;
        next.sources.insert(ProviderName::Calendar, source);
        self.commit_calendar(&mut inner, next).await?;
        drop(inner);
        if self.secrets.delete(Some(old)).await.is_err() {
            let mut inner = self.inner.lock().await;
            let mut next = inner.config.clone();
            next.settings.calendar_secret_deletion_pending = true;
            self.persist(&next).await?;
            inner.config = next;
            return Err(ServiceError);
        }
        Ok(())
    }
    pub async fn clear_calendar_secret(&self) -> Result<(), ServiceError> {
        let _admin = self.calendar_admin.lock().await;
        let mut inner = self.inner.lock().await;
        let mut next = inner.config.clone();
        next.settings.calendar_enabled = false;
        next.settings.calendar_secret_deletion_pending = true;
        next.sources
            .insert(ProviderName::Calendar, uuid::Uuid::new_v4().to_string());
        // Disable durably and clear display/cache before touching a possibly locked keyring.
        self.commit_calendar(&mut inner, next).await?;
        drop(inner);
        self.secrets.delete(None).await.map_err(|_| ServiceError)?;
        let mut inner = self.inner.lock().await;
        let mut next = inner.config.clone();
        next.settings.calendar_secret_deletion_pending = false;
        self.persist(&next).await?;
        inner.config = next;
        Ok(())
    }
    async fn persist(&self, next: &Config) -> Result<(), ServiceError> {
        let store = self.config_store.clone();
        let next = next.clone();
        tokio::task::spawn_blocking(move || next.save(&store))
            .await
            .map_err(|_| ServiceError)?
            .map_err(|_| ServiceError)
    }
    async fn commit_calendar(&self, inner: &mut Inner, next: Config) -> Result<(), ServiceError> {
        self.persist(&next).await?;
        let name = ProviderName::Calendar;
        inner
            .state
            .set_source(name, next.sources[&name].clone(), next.enabled(name));
        inner.config = next;
        inner.state.bump(name).map_err(|_| ServiceError)?;
        self.notify(inner, name);
        self.reconcile(inner);
        self.controls[&name].send_modify(|control| control.epoch += 1);
        let cache = self.cache.clone();
        tokio::task::spawn_blocking(move || cache.remove_provider(name))
            .await
            .map_err(|_| ServiceError)?
            .map_err(|_| ServiceError)
    }
    pub async fn new_with_secrets(
        config: PathBuf,
        cache: PathBuf,
        collector: Arc<dyn Collector>,
        secrets: Arc<dyn crate::secrets::SecretStore>,
    ) -> Result<Arc<Self>, ServiceError> {
        let (config_store, cache, config, state) = tokio::task::spawn_blocking(move || {
            let config_store = PrivateStore::new(&config)?;
            let cache = PrivateStore::new(&cache)?;
            let config = Config::load(&config_store)?;
            if !config.settings.calendar_enabled {
                cache.remove_provider(ProviderName::Calendar)?;
            }
            let mut state = ServiceState::new();
            for provider in ProviderName::ALL {
                let source = config.sources[&provider].clone();
                state.set_source(provider, source.clone(), config.enabled(provider));
                if config.enabled(provider)
                    && let Ok(Some(bytes)) = cache.read(&CacheKey::new(provider, &source)?)
                    && let Ok(value) = serde_json::from_slice::<Value>(&bytes)
                    && value["context"] == config.context_key(provider)
                {
                    state.restore(provider, value["state"].clone());
                }
            }
            state
                .snapshot_json()
                .map_err(|_| std::io::Error::other("invalid state"))?;
            Ok::<_, std::io::Error>((config_store, cache, config, state))
        })
        .await
        .map_err(|_| ServiceError)?
        .map_err(|_| ServiceError)?;
        Ok(Arc::new(Self {
            inner: Mutex::new(Inner {
                state,
                config,
                subscriptions: BTreeMap::new(),
                refresh: BTreeMap::new(),
            }),
            config_store,
            cache,
            collector,
            secrets,
            calendar_admin: Mutex::new(()),
            search_gate: Mutex::new(None),
            blocking: crate::worker::BlockingWorker::new(2),
            controls: ProviderName::ALL
                .into_iter()
                .map(|p| (p, watch::channel(Control::default()).0))
                .collect(),
            changes: broadcast::channel(64).0,
        }))
    }
    pub async fn snapshot(&self) -> Result<Value, ServiceError> {
        serde_json::from_str(&self.snapshot_json().await?).map_err(|_| ServiceError)
    }
    pub async fn snapshot_json(&self) -> Result<String, ServiceError> {
        self.inner
            .lock()
            .await
            .state
            .snapshot_json()
            .map_err(|_| ServiceError)
    }
    pub async fn settings_json(&self) -> Result<String, ServiceError> {
        serde_json::to_string(&self.inner.lock().await.config.settings).map_err(|_| ServiceError)
    }
    pub async fn active(&self, name: ProviderName) -> bool {
        self.controls[&name].borrow().active
    }
    fn notify(&self, inner: &Inner, name: ProviderName) {
        let _ = self.changes.send(Change {
            provider: name,
            revision: inner.state.revision(name),
            payload: inner.state.provider(name).to_string(),
        });
    }
    fn reconcile(&self, inner: &mut Inner) {
        for name in ProviderName::ALL {
            let active = inner.config.enabled(name)
                && inner
                    .subscriptions
                    .values()
                    .any(|s| s.providers.contains(&name));
            if self.controls[&name].borrow().active != active {
                inner.state.invalidate_jobs(name);
                self.controls[&name].send_modify(|control| {
                    control.active = active;
                    control.epoch += 1;
                });
            }
        }
    }
    async fn subscribe(
        &self,
        connection: &zbus::Connection,
        sender: String,
        names: Vec<String>,
    ) -> zbus::fdo::Result<String> {
        if names.is_empty() || names.len() > 5 {
            return Err(invalid());
        }
        let providers = names
            .iter()
            .map(|s| ProviderName::parse(s).ok_or_else(invalid))
            .collect::<Result<BTreeSet<_>, _>>()?;
        let mut inner = self.inner.lock().await;
        if inner.subscriptions.len() >= 128
            || inner
                .subscriptions
                .values()
                .filter(|s| s.sender == sender)
                .count()
                >= 8
        {
            return Err(zbus::fdo::Error::LimitsExceeded(
                "subscription limit".into(),
            ));
        }
        let token = uuid::Uuid::new_v4().to_string();
        inner.subscriptions.insert(
            token.clone(),
            Subscription {
                sender: sender.clone(),
                providers,
            },
        );
        drop(inner);
        // NameOwnerChanged may have been processed before this queued method.
        // Confirm liveness after insertion, then reconcile the remaining records.
        let alive = async {
            let proxy = zbus::fdo::DBusProxy::new(connection).await?;
            proxy
                .name_has_owner(sender.as_str().try_into().map_err(|_| invalid())?)
                .await
        }
        .await
        .unwrap_or(false);
        if !alive {
            self.remove_sender(&sender).await;
            return Err(zbus::fdo::Error::Failed(
                "subscription caller disconnected".into(),
            ));
        }
        self.reconcile(&mut *self.inner.lock().await);
        Ok(token)
    }
    async fn unsubscribe(&self, sender: &str, token: &str) -> zbus::fdo::Result<()> {
        let mut inner = self.inner.lock().await;
        if inner
            .subscriptions
            .get(token)
            .is_some_and(|s| s.sender != sender)
        {
            return Err(zbus::fdo::Error::AccessDenied(
                "subscription owner mismatch".into(),
            ));
        }
        inner.subscriptions.remove(token);
        self.reconcile(&mut inner);
        Ok(())
    }
    async fn remove_sender(&self, sender: &str) {
        let mut inner = self.inner.lock().await;
        inner.subscriptions.retain(|_, s| s.sender != sender);
        self.reconcile(&mut inner);
    }
    async fn refresh(&self, name: ProviderName) -> zbus::fdo::Result<()> {
        let mut inner = self.inner.lock().await;
        if !self.controls[&name].borrow().active {
            return Err(zbus::fdo::Error::Failed("provider inactive".into()));
        }
        if inner.refresh.get(&name).is_some_and(|last| {
            last.elapsed() < Duration::from_secs(if name == ProviderName::Weather { 60 } else { 5 })
        }) {
            return Err(zbus::fdo::Error::LimitsExceeded(
                "refresh rate limited".into(),
            ));
        }
        inner.refresh.insert(name, Instant::now());
        self.controls[&name].send_modify(|control| control.epoch += 1);
        inner.state.invalidate_jobs(name);
        Ok(())
    }
    pub async fn configure(&self, change: SettingChange) -> Result<(), ServiceError> {
        let mut inner = self.inner.lock().await;
        let mut next = inner.config.clone();
        let (name, new_source) = match change {
            SettingChange::Context(value) => {
                if next.context.as_ref() == Some(&value) {
                    return Ok(());
                }
                next.context = Some(value);
                (ProviderName::Calendar, false)
            }
            SettingChange::Weather(value) => {
                if next.settings.weather_location == value {
                    return Ok(());
                }
                next.settings.weather_location = value;
                (ProviderName::Weather, true)
            }
            SettingChange::Network(value) => {
                if next.settings.network_interface == value {
                    return Ok(());
                }
                next.settings.network_interface = value;
                (ProviderName::Network, true)
            }
        };
        let old_source = next.sources[&name].clone();
        if new_source {
            next.sources.insert(name, uuid::Uuid::new_v4().to_string());
        }
        let config_store = self.config_store.clone();
        let persisted = next.clone();
        tokio::task::spawn_blocking(move || persisted.save(&config_store))
            .await
            .map_err(|_| ServiceError)?
            .map_err(|_| ServiceError)?;
        inner
            .state
            .set_source(name, next.sources[&name].clone(), next.enabled(name));
        inner.config = next;
        inner.state.bump(name).map_err(|_| ServiceError)?;
        self.notify(&inner, name);
        self.reconcile(&mut inner);
        self.controls[&name].send_modify(|control| control.epoch += 1);
        let cache = self.cache.clone();
        let _ =
            tokio::task::spawn_blocking(move || cache.remove(&CacheKey::new(name, &old_source)?))
                .await;
        Ok(())
    }
    async fn request(&self, name: ProviderName) -> CollectRequest {
        let inner = self.inner.lock().await;
        let mut request = CollectRequest {
            ticket: inner.state.begin(name),
            config: inner.config.clone(),
            blocking: self.blocking.clone(),
            calendar_cache: None,
        };
        drop(inner);
        if name == ProviderName::Calendar {
            let cache = self.cache.clone();
            let source = request.ticket.source_id.clone();
            request.calendar_cache =
                tokio::task::spawn_blocking(move || cache.read_calendar(&source))
                    .await
                    .ok()
                    .and_then(Result::ok)
                    .flatten();
        }
        request
    }
    async fn complete(
        &self,
        request: &CollectRequest,
        result: Result<Collected, Failure>,
    ) -> Result<(), ServiceError> {
        let mut inner = self.inner.lock().await;
        let name = request.ticket.provider;
        let (result, updated_at, stale, raw) = match result {
            Ok(value) => (
                Ok(value.data),
                value.updated_at,
                value.stale,
                value.calendar_cache,
            ),
            Err(error) => (Err(error), None, None, None),
        };
        if !self.controls[&name].borrow().active
            || !inner
                .state
                .finish_report(&request.ticket, result, updated_at, stale)
                .map_err(|_| ServiceError)?
        {
            return Ok(());
        }
        let fresh = inner.state.provider(name)["status"] == "ok";
        if fresh && let Some(raw) = raw {
            let cache = self.cache.clone();
            let source = request.ticket.source_id.clone();
            if !matches!(
                tokio::task::spawn_blocking(move || cache.write_calendar(&source, &raw)).await,
                Ok(Ok(()))
            ) {
                eprintln!("calendar cache write failed");
            }
        }
        if !inner.state.provider(name)["data"].is_null() {
            let bytes=json!({"context":inner.config.context_key(name),"state":inner.state.provider(name)}).to_string().into_bytes();
            let cache = self.cache.clone();
            let key = CacheKey::new(name, &request.ticket.source_id).map_err(|_| ServiceError)?;
            if !matches!(
                tokio::task::spawn_blocking(move || cache.write(&key, &bytes)).await,
                Ok(Ok(()))
            ) {
                eprintln!("provider cache write failed");
            }
        }
        self.notify(&inner, name);
        Ok(())
    }
    async fn worker(self: Arc<Self>, name: ProviderName) {
        let mut control = self.controls[&name].subscribe();
        let mut failures = 0_u32;
        let mut source = String::new();
        loop {
            let current = *control.borrow_and_update();
            if !current.active {
                failures = 0;
                if control.changed().await.is_err() {
                    return;
                }
                continue;
            }
            let request = self.request(name).await;
            if *control.borrow() != current {
                continue;
            }
            if source != request.ticket.source_id {
                source = request.ticket.source_id.clone();
                failures = 0;
            }
            let result = tokio::select! {
                result=self.collector.collect(request.clone())=>result,
                changed=control.changed()=>{if changed.is_err(){return;}continue;}
            };
            let error = match &result {
                Err(error) => Some(*error),
                Ok(value) => value.stale,
            };
            failures = if error.is_some() {
                failures.saturating_add(1)
            } else {
                0
            };
            let interval =
                crate::schedule::poll_seconds(name, failures, error == Some(Failure::RateLimited));
            let _ = self.complete(&request, result).await;
            tokio::select! { _=tokio::time::sleep(Duration::from_secs(interval))=>{}, changed=control.changed()=>{if changed.is_err(){return;}} }
        }
    }
}
fn invalid() -> zbus::fdo::Error {
    zbus::fdo::Error::InvalidArgs("invalid request".into())
}
fn failed(_: ServiceError) -> zbus::fdo::Error {
    zbus::fdo::Error::Failed("local service operation failed".into())
}
fn sender(header: &zbus::message::Header<'_>) -> zbus::fdo::Result<String> {
    header.sender().map(ToString::to_string).ok_or_else(invalid)
}
struct Interface(Arc<Runtime>);
#[zbus::interface(name = "org.local.LiquidWidgets1")]
impl Interface {
    async fn get_snapshot(&self) -> zbus::fdo::Result<String> {
        self.0.snapshot_json().await.map_err(failed)
    }
    async fn get_settings(&self) -> zbus::fdo::Result<String> {
        self.0.settings_json().await.map_err(failed)
    }
    async fn subscribe(
        &self,
        providers: Vec<String>,
        #[zbus(connection)] connection: &zbus::Connection,
        #[zbus(header)] header: zbus::message::Header<'_>,
    ) -> zbus::fdo::Result<String> {
        self.0
            .subscribe(connection, sender(&header)?, providers)
            .await
    }
    async fn unsubscribe(
        &self,
        token: String,
        #[zbus(header)] header: zbus::message::Header<'_>,
    ) -> zbus::fdo::Result<()> {
        if token.len() > 128 {
            return Err(invalid());
        }
        self.0.unsubscribe(&sender(&header)?, &token).await
    }
    async fn refresh(&self, provider: String) -> zbus::fdo::Result<()> {
        self.0
            .refresh(ProviderName::parse(&provider).ok_or_else(invalid)?)
            .await
    }
    async fn set_calendar_context(&self, context_json: String) -> zbus::fdo::Result<()> {
        self.0
            .configure(SettingChange::Context(
                validation::parse_calendar_context(&context_json).map_err(|_| invalid())?,
            ))
            .await
            .map_err(failed)
    }
    async fn set_weather_location(&self, location_json: String) -> zbus::fdo::Result<()> {
        self.0
            .configure(SettingChange::Weather(
                validation::parse_weather_location(&location_json).map_err(|_| invalid())?,
            ))
            .await
            .map_err(failed)
    }
    async fn set_network_interface(&self, name: String) -> zbus::fdo::Result<()> {
        if name.is_empty()
            || name.len() > 64
            || !name
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"_.:-".contains(&b))
        {
            return Err(invalid());
        }
        self.0
            .configure(SettingChange::Network(name))
            .await
            .map_err(failed)
    }
    async fn set_calendar_secret(&self, url: String) -> zbus::fdo::Result<()> {
        self.0.set_calendar_secret(url).await.map_err(failed)
    }
    async fn clear_calendar_secret(&self) -> zbus::fdo::Result<()> {
        self.0.clear_calendar_secret().await.map_err(failed)
    }
    async fn search_locations(&self, query: String) -> zbus::fdo::Result<String> {
        if !(2..=100).contains(&query.trim().chars().count()) {
            return Err(invalid());
        }
        let mut gate = self
            .0
            .search_gate
            .try_lock()
            .map_err(|_| zbus::fdo::Error::LimitsExceeded("search busy".into()))?;
        if gate.is_some_and(|last| last.elapsed() < Duration::from_secs(1)) {
            return Err(zbus::fdo::Error::LimitsExceeded(
                "search rate limited".into(),
            ));
        }
        *gate = Some(Instant::now());
        let locations = self
            .0
            .collector
            .search_locations(query)
            .await
            .map_err(|_| zbus::fdo::Error::Failed("location search failed".into()))?;
        let output = serde_json::to_string(&locations).map_err(|_| failed(ServiceError))?;
        validation::parse_location_search_results(&output).map_err(|_| failed(ServiceError))?;
        Ok(output)
    }
    #[zbus(signal)]
    async fn provider_changed(
        emitter: &zbus::object_server::SignalEmitter<'_>,
        provider: &str,
        revision: u32,
        payload: &str,
    ) -> zbus::Result<()>;
}
pub struct Server {
    connection: zbus::Connection,
    tasks: Vec<JoinHandle<()>>,
}
impl Server {
    pub async fn closed(&self) {
        self.connection.closed().await;
    }
    pub async fn start(runtime: Arc<Runtime>) -> zbus::Result<Self> {
        let connection = zbus::connection::Builder::session()?
            .serve_at(PATH, Interface(runtime.clone()))?
            .build()
            .await?;
        let proxy = zbus::fdo::DBusProxy::new(&connection).await?;
        let mut owners = proxy.receive_name_owner_changed().await?;
        let mut changes = runtime.changes.subscribe();
        let owner_runtime = runtime.clone();
        let mut tasks = vec![tokio::spawn(async move {
            while let Some(signal) = owners.next().await {
                if let Ok(args) = signal.args()
                    && args.name().as_str().starts_with(':')
                    && args.new_owner().is_none()
                {
                    owner_runtime.remove_sender(args.name().as_str()).await;
                }
            }
        })];
        let output = connection.clone();
        let output_runtime = runtime.clone();
        tasks.push(tokio::spawn(async move {
            loop {
                let batch = match changes.recv().await {
                    Ok(change) => vec![change],
                    Err(broadcast::error::RecvError::Lagged(_)) => {
                        let inner = output_runtime.inner.lock().await;
                        ProviderName::ALL
                            .into_iter()
                            .map(|provider| Change {
                                provider,
                                revision: inner.state.revision(provider),
                                payload: inner.state.provider(provider).to_string(),
                            })
                            .collect()
                    }
                    Err(_) => break,
                };
                for change in batch {
                    if output
                        .emit_signal(
                            None::<&str>,
                            PATH,
                            IFACE,
                            "ProviderChanged",
                            &(change.provider.as_str(), change.revision, change.payload),
                        )
                        .await
                        .is_err()
                    {
                        return;
                    }
                }
            }
        }));
        for provider in ProviderName::ALL {
            let worker = runtime.clone();
            tasks.push(tokio::spawn(worker.worker(provider)));
        }
        let server = Self { connection, tasks };
        server
            .connection
            .request_name_with_flags(NAME, zbus::fdo::RequestNameFlags::DoNotQueue.into())
            .await?;
        Ok(server)
    }
    pub async fn shutdown(mut self) -> zbus::Result<()> {
        for task in self.tasks.drain(..) {
            task.abort();
            let _ = task.await;
        }
        self.connection.clone().close().await
    }
}
impl Drop for Server {
    fn drop(&mut self) {
        for task in &self.tasks {
            task.abort();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn delayed_subscribe_does_not_keep_a_disconnected_sender() {
        if std::env::var("LIQUID_PRIVATE_TEST").is_err() {
            let status = std::process::Command::new("dbus-run-session")
                .arg("--")
                .arg(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "service::tests::delayed_subscribe_does_not_keep_a_disconnected_sender",
                    "--nocapture",
                ])
                .env("LIQUID_PRIVATE_TEST", "1")
                .env(
                    "LIQUID_PARENT_BUS",
                    std::env::var("DBUS_SESSION_BUS_ADDRESS").unwrap_or_default(),
                )
                .status()
                .unwrap();
            assert!(status.success());
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
                let runtime = Runtime::new(
                    dir.path().join("config"),
                    dir.path().join("cache"),
                    Arc::new(UnavailableCollector),
                )
                .await
                .unwrap();
                let client = zbus::Connection::session().await.unwrap();
                let name = client.unique_name().unwrap().to_string();
                client.close().await.unwrap();
                let connection = zbus::Connection::session().await.unwrap();
                assert!(
                    runtime
                        .subscribe(&connection, name, vec!["system".into()])
                        .await
                        .is_err()
                );
                assert!(!runtime.active(ProviderName::System).await);
            });
    }
}
