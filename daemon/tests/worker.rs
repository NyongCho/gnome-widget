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

#[tokio::test]
async fn queued_work_waits_for_capacity_and_drops_cancelled_tasks() {
    let worker = BlockingWorker::new(1);
    let (release, wait) = std::sync::mpsc::channel();
    let (started, ready) = tokio::sync::oneshot::channel();
    let busy = tokio::spawn({
        let worker = worker.clone();
        async move {
            worker
                .run(move || {
                    started.send(()).unwrap();
                    wait.recv_timeout(Duration::from_secs(3)).unwrap();
                })
                .await
                .unwrap();
        }
    });
    ready.await.unwrap();
    let cancelled_ran = Arc::new(AtomicBool::new(false));
    let ran = cancelled_ran.clone();
    let mut cancelled =
        Box::pin(worker.run_when_available(move || ran.store(true, Ordering::SeqCst)));
    assert!(futures_util::poll!(cancelled.as_mut()).is_pending());
    let queued_ran = Arc::new(AtomicBool::new(false));
    let ran = queued_ran.clone();
    let mut queued = Box::pin(worker.run_when_available(move || {
        ran.store(true, Ordering::SeqCst);
        42
    }));
    assert!(futures_util::poll!(queued.as_mut()).is_pending());
    assert!(!cancelled_ran.load(Ordering::SeqCst));
    assert!(!queued_ran.load(Ordering::SeqCst));
    assert!(matches!(worker.run(|| ()).await, Err(WorkerError::Busy)));
    drop(cancelled);
    release.send(()).unwrap();
    busy.await.unwrap();
    assert_eq!(
        tokio::time::timeout(Duration::from_secs(1), queued)
            .await
            .unwrap()
            .unwrap(),
        42
    );
    assert!(queued_ran.load(Ordering::SeqCst));
    assert!(!cancelled_ran.load(Ordering::SeqCst));
    assert_eq!(worker.run(|| 9).await.unwrap(), 9);
}
