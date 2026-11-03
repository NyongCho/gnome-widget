pub mod calendar;
pub mod calendar_feed;

use crate::{
    service::{CollectRequest, Collected, Collector},
    state::Failure,
    types::ProviderName,
};
use std::{future::Future, pin::Pin};
pub struct Providers {
    pub system: system::System,
    pub network: network::Network,
    pub calendar: calendar_feed::CalendarFeed,
    pub weather: weather::Weather,
}
impl Collector for Providers {
    fn search_locations(
        &self,
        query: String,
    ) -> Pin<
        Box<dyn Future<Output = Result<Vec<crate::types::WeatherLocation>, Failure>> + Send + '_>,
    > {
        Box::pin(async move { self.weather.search(&query).await })
    }
    fn collect(
        &self,
        request: CollectRequest,
    ) -> Pin<Box<dyn Future<Output = Result<Collected, Failure>> + Send + '_>> {
        Box::pin(async move {
            match request.ticket.provider {
                ProviderName::Calendar => {
                    let value = self
                        .calendar
                        .collect(
                            &request.ticket.source_id,
                            request.config.context.ok_or(Failure::Unavailable)?,
                            crate::state::now(),
                            request.calendar_cache,
                            request.blocking,
                        )
                        .await?;
                    Ok(Collected {
                        data: serde_json::to_value(value.data).map_err(|_| Failure::Invalid)?,
                        updated_at: Some(value.cached.fetched_at.clone()),
                        stale: value.stale,
                        calendar_cache: Some(value.cached),
                    })
                }
                ProviderName::Weather => {
                    let location = request
                        .config
                        .settings
                        .weather_location
                        .ok_or(Failure::Unavailable)?;
                    let now = chrono::DateTime::<chrono::Utc>::from(std::time::SystemTime::now())
                        .timestamp();
                    let data = self.weather.collect(&location, now).await?;
                    Ok(serde_json::to_value(data)
                        .map_err(|_| Failure::Invalid)?
                        .into())
                }
                ProviderName::System => Ok(serde_json::to_value(
                    self.system
                        .collect(request.ticket, request.blocking)
                        .await?,
                )
                .map_err(|_| Failure::Invalid)?
                .into()),
                ProviderName::Network => Ok(serde_json::to_value(
                    self.network
                        .collect(
                            request.ticket,
                            request.config.settings.network_interface,
                            request.blocking,
                        )
                        .await?,
                )
                .map_err(|_| Failure::Invalid)?
                .into()),
                ProviderName::Media => Ok(serde_json::to_value(
                    media::collect(request.previous, request.blocking).await?,
                )
                .map_err(|_| Failure::Invalid)?
                .into()),
            }
        })
    }
}
pub mod media;
pub mod network;
pub mod system;
pub mod weather;
