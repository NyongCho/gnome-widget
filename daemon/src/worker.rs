use crate::{
    providers::calendar::{CalendarError, expand_ics},
    types::{CalendarContext, CalendarEvent},
};
use std::sync::Arc;
use tokio::sync::Semaphore;
#[derive(Debug, thiserror::Error)]
pub enum WorkerError {
    #[error("worker busy")]
    Busy,
    #[error("worker unavailable")]
    Unavailable,
}
#[derive(Clone)]
pub struct BlockingWorker {
    slots: Arc<Semaphore>,
}
impl BlockingWorker {
    pub fn new(limit: usize) -> Self {
        Self {
            slots: Arc::new(Semaphore::new(limit)),
        }
    }
    pub async fn run<T: Send + 'static>(
        &self,
        task: impl FnOnce() -> T + Send + 'static,
    ) -> Result<T, WorkerError> {
        let permit = self
            .slots
            .clone()
            .try_acquire_owned()
            .map_err(|_| WorkerError::Busy)?;
        tokio::task::spawn_blocking(move || {
            let _permit = permit;
            task()
        })
        .await
        .map_err(|_| WorkerError::Unavailable)
    }
    /// Wait without spawning a blocking task until a worker slot is available.
    /// Dropping a queued future drops its task and cancels its permit request.
    pub async fn run_when_available<T: Send + 'static>(
        &self,
        task: impl FnOnce() -> T + Send + 'static,
    ) -> Result<T, WorkerError> {
        let permit = self
            .slots
            .clone()
            .acquire_owned()
            .await
            .map_err(|_| WorkerError::Unavailable)?;
        tokio::task::spawn_blocking(move || {
            let _permit = permit;
            task()
        })
        .await
        .map_err(|_| WorkerError::Unavailable)
    }
    pub async fn expand(
        &self,
        ics: String,
        context: CalendarContext,
        now: String,
    ) -> Result<Result<Vec<CalendarEvent>, CalendarError>, WorkerError> {
        // CPU/network may occupy both slots during simultaneous activation.
        // Keep this cancellable calendar request queued instead of losing it
        // until the provider's next five-minute poll.
        self.run_when_available(move || expand_ics(&ics, &context, &now))
            .await
    }
}
