use crate::{
    http::Fetcher,
    secrets::SecretStore,
    state::Failure,
    types::{CalendarContext, CalendarData},
    worker::BlockingWorker,
};
use std::sync::Arc;
#[derive(Clone)]
pub struct CalendarCache {
    pub fetched_at: String,
    pub ics: String,
}
pub struct CalendarCollection {
    pub data: CalendarData,
    pub cached: CalendarCache,
    pub stale: Option<Failure>,
}
pub struct CalendarFeed {
    pub fetcher: Arc<dyn Fetcher>,
    pub secrets: Arc<dyn SecretStore>,
}
impl CalendarFeed {
    pub async fn collect(
        &self,
        source: &str,
        context: CalendarContext,
        now: String,
        cached: Option<CalendarCache>,
        worker: BlockingWorker,
    ) -> Result<CalendarCollection, Failure> {
        let secret = self
            .secrets
            .read(source.to_owned())
            .await
            .map_err(|_| Failure::Keyring)?;
        let url = crate::secrets::validate_calendar_url(&secret).map_err(|_| Failure::Auth)?;
        let fetched = self.fetcher.get(url, super::calendar::MAX_ICS_BYTES).await;
        let fresh = match fetched {
            Ok(bytes) => match String::from_utf8(bytes) {
                Ok(ics) => {
                    self.expand(
                        CalendarCache {
                            fetched_at: now.clone(),
                            ics,
                        },
                        context.clone(),
                        now.clone(),
                        &worker,
                        None,
                    )
                    .await
                }
                Err(_) => Err(Failure::Invalid),
            },
            Err(error) => Err(error),
        };
        match fresh {
            Ok(value) => Ok(value),
            Err(error) => match cached {
                Some(cached) => {
                    self.expand(cached, context, now, &worker, Some(error))
                        .await
                }
                None => Err(error),
            },
        }
    }
    async fn expand(
        &self,
        cached: CalendarCache,
        context: CalendarContext,
        now: String,
        worker: &BlockingWorker,
        stale: Option<Failure>,
    ) -> Result<CalendarCollection, Failure> {
        use super::calendar::CalendarError as E;
        let events = worker
            .expand(cached.ics.clone(), context.clone(), now)
            .await
            .map_err(|_| Failure::Unavailable)?
            .map_err(|error| match error {
                E::UnsupportedCalendar => Failure::Unsupported,
                E::UnknownTimeZone => Failure::TimeZone,
                E::InputLimit => Failure::TooLarge,
                E::ExpansionLimit => Failure::ExpansionLimit,
                _ => Failure::Invalid,
            })?;
        Ok(CalendarCollection {
            data: CalendarData {
                month: context.month,
                time_zone: context.time_zone,
                week_start: context.week_start,
                events,
            },
            cached,
            stale,
        })
    }
}
