use crate::state::Failure;
use std::{future::Future, pin::Pin};
pub type FetchFuture<'a> = Pin<Box<dyn Future<Output = Result<Vec<u8>, Failure>> + Send + 'a>>;
pub trait Fetcher: Send + Sync {
    fn get(&self, url: reqwest::Url, limit: usize) -> FetchFuture<'_>;
}
pub struct Http {
    client: reqwest::Client,
}
impl Http {
    pub fn new() -> Result<Self, Failure> {
        Ok(Self {
            client: reqwest::Client::builder()
                .https_only(true)
                .redirect(reqwest::redirect::Policy::none())
                .timeout(std::time::Duration::from_secs(15))
                .build()
                .map_err(|_| Failure::Unavailable)?,
        })
    }
    pub fn with_client(client: reqwest::Client) -> Self {
        Self { client }
    }
}
impl Fetcher for Http {
    fn get(&self, url: reqwest::Url, limit: usize) -> FetchFuture<'_> {
        Box::pin(async move {
            let mut response = self
                .client
                .get(url)
                .send()
                .await
                .map_err(|_| Failure::Network)?;
            match response.status().as_u16() {
                200..=299 => {}
                401 | 403 | 404 => return Err(Failure::Auth),
                429 => return Err(Failure::RateLimited),
                _ => return Err(Failure::Network),
            }
            if response
                .content_length()
                .is_some_and(|length| length > limit as u64)
            {
                return Err(Failure::TooLarge);
            }
            let mut bytes = Vec::new();
            while let Some(chunk) = response.chunk().await.map_err(|_| Failure::Network)? {
                if chunk.len() > limit.saturating_sub(bytes.len()) {
                    return Err(Failure::TooLarge);
                }
                bytes.extend_from_slice(&chunk);
            }
            Ok(bytes)
        })
    }
}
