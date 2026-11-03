//! Only this adapter handles private URLs. Errors never contain the input or D-Bus details.
use std::{future::Future, pin::Pin};
#[derive(Debug, Clone, Copy, thiserror::Error)]
#[error("calendar keyring operation failed")]
pub struct SecretError;
pub type SecretFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, SecretError>> + Send + 'a>>;
pub trait SecretStore: Send + Sync {
    fn read(&self, source: String) -> SecretFuture<'_, String>;
    fn write(&self, source: String, url: String) -> SecretFuture<'_, ()>;
    fn delete(&self, source: Option<String>) -> SecretFuture<'_, ()>;
}
pub struct NoSecrets;
impl SecretStore for NoSecrets {
    fn read(&self, _source: String) -> SecretFuture<'_, String> {
        Box::pin(async { Err(SecretError) })
    }
    fn write(&self, _source: String, _url: String) -> SecretFuture<'_, ()> {
        Box::pin(async { Err(SecretError) })
    }
    fn delete(&self, _source: Option<String>) -> SecretFuture<'_, ()> {
        Box::pin(async { Err(SecretError) })
    }
}
pub fn validate_calendar_url(url: &str) -> Result<reqwest::Url, SecretError> {
    if url.len() > 8192 || url.trim() != url || url.bytes().any(|b| b.is_ascii_control()) {
        return Err(SecretError);
    }
    let parsed = reqwest::Url::parse(url).map_err(|_| SecretError)?;
    let parts: Vec<_> = parsed.path_segments().ok_or(SecretError)?.collect();
    if parsed.scheme() != "https"
        || parsed.host_str() != Some("calendar.google.com")
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.port().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
        || parts.len() != 5
        || parts[0] != "calendar"
        || parts[1] != "ical"
        || parts[2].is_empty()
        || !(parts[3].starts_with("private-") || parts[3] == "public")
        || parts[4] != "basic.ics"
    {
        return Err(SecretError);
    }
    Ok(parsed)
}

pub struct SystemSecrets;
const APP: &str = "org.local.LiquidWidgets";
async fn connect() -> Result<secret_service::SecretService<'static>, SecretError> {
    secret_service::SecretService::connect(secret_service::EncryptionType::Dh)
        .await
        .map_err(|_| SecretError)
}
async fn bounded<T>(
    future: impl Future<Output = Result<T, SecretError>>,
) -> Result<T, SecretError> {
    tokio::time::timeout(std::time::Duration::from_secs(8), future)
        .await
        .map_err(|_| SecretError)?
}
impl SecretStore for SystemSecrets {
    fn read(&self, source: String) -> SecretFuture<'_, String> {
        Box::pin(bounded(async move {
            let service = connect().await?;
            let found = service
                .search_items(std::collections::HashMap::from([
                    ("application", APP),
                    ("source", source.as_str()),
                ]))
                .await
                .map_err(|_| SecretError)?;
            if !found.locked.is_empty() {
                return Err(SecretError);
            }
            let item = found.unlocked.first().ok_or(SecretError)?;
            let value = String::from_utf8(item.get_secret().await.map_err(|_| SecretError)?)
                .map_err(|_| SecretError)?;
            validate_calendar_url(&value)?;
            Ok(value)
        }))
    }
    fn write(&self, source: String, url: String) -> SecretFuture<'_, ()> {
        Box::pin(bounded(async move {
            validate_calendar_url(&url)?;
            let service = connect().await?;
            let collection = service
                .get_default_collection()
                .await
                .map_err(|_| SecretError)?;
            if collection.is_locked().await.map_err(|_| SecretError)? {
                return Err(SecretError);
            }
            collection
                .create_item(
                    "Liquid Widgets · Google Calendar",
                    std::collections::HashMap::from([
                        ("application", APP),
                        ("source", source.as_str()),
                    ]),
                    url.as_bytes(),
                    true,
                    "text/plain",
                )
                .await
                .map_err(|_| SecretError)?;
            Ok(())
        }))
    }
    fn delete(&self, source: Option<String>) -> SecretFuture<'_, ()> {
        Box::pin(bounded(async move {
            let service = connect().await?;
            let mut attributes = std::collections::HashMap::from([("application", APP)]);
            if let Some(source) = &source {
                attributes.insert("source", source.as_str());
            }
            let found = service
                .search_items(attributes)
                .await
                .map_err(|_| SecretError)?;
            for item in found.unlocked {
                item.delete().await.map_err(|_| SecretError)?;
            }
            if !found.locked.is_empty() {
                return Err(SecretError);
            }
            Ok(())
        }))
    }
}
