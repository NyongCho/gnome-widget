use liquid_widgets_daemon::{
    state::{Failure, ServiceState},
    types::ProviderName as P,
    validation::parse_snapshot,
};
use serde_json::{Value, json};
fn system() -> Value {
    json!({"cpuPercent":4,"memoryUsedBytes":100,"memoryTotalBytes":200,"temperatureC":null})
}
#[test]
fn old_source_response_is_discarded() {
    let mut state = ServiceState::new();
    let old = state.begin(P::System);
    state.change_source(P::System, true);
    let current = state.begin(P::System);
    assert!(!state.finish(&old, Ok(system())).unwrap());
    assert_eq!(state.provider(P::System)["data"], Value::Null);
    assert!(state.finish(&current, Ok(system())).unwrap());
    assert_eq!(state.provider(P::System)["data"]["cpuPercent"], 4);
}
#[test]
fn old_context_and_stopped_collection_results_are_discarded() {
    let mut state = ServiceState::new();
    let old = state.begin(P::System);
    state.invalidate_jobs(P::System);
    assert!(!state.finish(&old, Ok(system())).unwrap());
}
#[test]
fn provider_failure_is_independent_and_preserves_last_success_time() {
    let mut state = ServiceState::new();
    let job = state.begin(P::System);
    state.finish(&job, Ok(system())).unwrap();
    let first = state.provider(P::System).clone();
    state.finish(&job, Err(Failure::Network)).unwrap();
    assert_eq!(state.provider(P::System)["status"], "stale");
    assert_eq!(state.provider(P::System)["updatedAt"], first["updatedAt"]);
    assert_eq!(state.provider(P::System)["data"], first["data"]);
    assert_eq!(state.provider(P::Calendar)["status"], "unconfigured");
    parse_snapshot(&state.snapshot_json().unwrap()).unwrap();
}
#[test]
fn oversized_provider_becomes_explicit_error_without_poisoning_snapshot() {
    let mut state = ServiceState::new();
    let job = state.begin(P::Calendar);
    let mut fixture: Value = serde_json::from_str(include_str!(
        "../../tests/fixtures/protocol/snapshot-valid.json"
    ))
    .unwrap();
    let mut event = fixture["calendar"]["data"]["events"][0].clone();
    event["title"] = json!("한".repeat(1300));
    fixture["calendar"]["data"]["events"] = json!(vec![event; 150]);
    state
        .finish(&job, Ok(fixture["calendar"]["data"].clone()))
        .unwrap();
    assert_eq!(
        state.provider(P::Calendar)["errorCode"],
        "PAYLOAD_TOO_LARGE"
    );
    parse_snapshot(&state.snapshot_json().unwrap()).unwrap();
}
