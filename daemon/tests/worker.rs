use liquid_widgets_daemon::worker::{BlockingWorker, WorkerError};
use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
#[tokio::test(flavor = "current_thread")]
async fn blocking_work_is_bounded_and_does_not_block_executor() {
    let worker = BlockingWorker::new(1);
    let running = Arc::new(AtomicBool::new(false));
    let release = Arc::new(AtomicBool::new(false));
    let task_worker = worker.clone();
    let started = running.clone();
    let stop = release.clone();
    let task = tokio::spawn(async move {
        task_worker
            .run(move || {
                started.store(true, Ordering::SeqCst);
                let deadline = std::time::Instant::now() + Duration::from_millis(500);
                while !stop.load(Ordering::SeqCst) && std::time::Instant::now() < deadline {
                    std::thread::sleep(Duration::from_millis(1));
                }
                7
            })
            .await
    });
    tokio::time::timeout(Duration::from_secs(1), async {
        while !running.load(Ordering::SeqCst) {
            tokio::time::sleep(Duration::from_millis(1)).await;
        }
    })
    .await
    .unwrap();
    assert!(matches!(worker.run(|| 8).await, Err(WorkerError::Busy)));
    release.store(true, Ordering::SeqCst);
    assert_eq!(task.await.unwrap().unwrap(), 7);
    assert_eq!(worker.run(|| 9).await.unwrap(), 9);
}
#[tokio::test]
async fn calendar_expansion_runs_on_bounded_worker() {
    let worker = BlockingWorker::new(1);
    let context = liquid_widgets_daemon::types::CalendarContext {
        month: "2026-11".into(),
        time_zone: "Asia/Seoul".into(),
        week_start: 1,
    };
    let events = worker
        .expand(
            include_str!("../../tests/fixtures/calendar/weekly-exdate.ics").into(),
            context,
            "2026-11-01T00:00:00Z".into(),
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(events.len(), 2);
}
