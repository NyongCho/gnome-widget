pub mod calendar;
pub mod calendar_feed;

use crate::{
    service::{CollectRequest, Collected, Collector},
    state::Failure,
    types::ProviderName,
};
use std::{future::Future, pin::Pin};
pub struct Providers {
    pub calendar: calendar_feed::CalendarFeed,
}
impl Collector for Providers {
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
                _ => Err(Failure::Unavailable),
            }
        })
    }
}
