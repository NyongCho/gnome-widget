use liquid_widgets_daemon::validation::{parse_settings, parse_snapshot};
use serde_json::{Value, json};
const SNAPSHOT: &str = include_str!("../../tests/fixtures/protocol/snapshot-valid.json");
const SETTINGS: &str = include_str!("../../tests/fixtures/protocol/settings-valid.json");
#[test]
fn shared_fixtures_round_trip_without_field_changes() {
    assert_eq!(
        serde_json::to_value(parse_snapshot(SNAPSHOT).unwrap()).unwrap(),
        serde_json::from_str::<Value>(SNAPSHOT).unwrap()
    );
    assert_eq!(
        serde_json::to_value(parse_settings(SETTINGS).unwrap()).unwrap(),
        serde_json::from_str::<Value>(SETTINGS).unwrap()
    );
}
#[test]
fn malformed_shared_cases_are_rejected() {
    let cases: Value = serde_json::from_str(include_str!(
        "../../tests/fixtures/protocol/invalid-cases.json"
    ))
    .unwrap();
    for case in cases.as_array().unwrap() {
        let settings = case["kind"] == "settings";
        let mut payload: Value =
            serde_json::from_str(if settings { SETTINGS } else { SNAPSHOT }).unwrap();
        let path = case["path"].as_array().unwrap();
        let mut target = &mut payload;
        for key in &path[..path.len() - 1] {
            target = if let Some(n) = key.as_u64() {
                &mut target[n as usize]
            } else {
                &mut target[key.as_str().unwrap()]
            };
        }
        target[path.last().unwrap().as_str().unwrap()] = case["value"].clone();
        let raw = payload.to_string();
        assert!(
            if settings {
                parse_settings(&raw).is_err()
            } else {
                parse_snapshot(&raw).is_err()
            },
            "{}",
            case["name"]
        );
    }
}
#[test]
fn utf8_limit_is_bytes_not_character_count() {
    let mut snapshot: Value = serde_json::from_str(SNAPSHOT).unwrap();
    let mut event = snapshot["calendar"]["data"]["events"][0].clone();
    event["title"] = json!("한".repeat(1300));
    snapshot["calendar"]["data"]["events"] = json!(vec![event; 150]);
    let raw = snapshot.to_string();
    assert!(raw.chars().count() < 512 * 1024);
    assert!(raw.len() > 512 * 1024);
    assert!(parse_snapshot(&raw).is_err());
}
#[test]
fn signal_payload_and_settings_inputs_use_shared_schemas() {
    use liquid_widgets_daemon::{types::ProviderName, validation::*};
    let snapshot: Value = serde_json::from_str(SNAPSHOT).unwrap();
    for name in [
        ProviderName::Calendar,
        ProviderName::Weather,
        ProviderName::System,
        ProviderName::Network,
        ProviderName::Media,
    ] {
        assert_eq!(
            validate_provider_state(name, &snapshot[name.as_str()].to_string()).unwrap(),
            snapshot[name.as_str()]
        );
    }
    assert!(
        validate_provider_state(ProviderName::System, &snapshot["weather"].to_string()).is_err()
    );
    assert!(
        validate_provider_state(ProviderName::Calendar, &" ".repeat(MAX_PAYLOAD_BYTES + 1))
            .is_err()
    );
    assert!(
        parse_calendar_context(r#"{"month":"2026-11","timeZone":"Asia/Seoul","weekStart":1}"#)
            .is_ok()
    );
    assert_eq!(parse_weather_location("null").unwrap(), None);
    assert!(parse_weather_location(r#"{"id":"seoul","label":"서울","latitude":37.5,"longitude":127.0,"timeZone":"Asia/Seoul"}"#).is_ok());
    assert!(parse_location_search_results("[]").unwrap().is_empty());
}
#[test]
fn errors_never_echo_private_input() {
    let error = parse_snapshot("https://calendar.google.com/private-secret").unwrap_err();
    assert_eq!(error.to_string(), "invalid protocol payload");
    assert!(!format!("{error:?}").contains("private-secret"));
}

#[test]
fn schema_integer_fields_accept_json_decimal_integer_notation() {
    let mut snapshot: Value = serde_json::from_str(SNAPSHOT).unwrap();
    snapshot["schemaVersion"] = json!(1.0);
    snapshot["revisions"]["calendar"] = json!(4.0);
    snapshot["calendar"]["data"]["weekStart"] = json!(1.0);
    snapshot["system"]["data"]["memoryUsedBytes"] = json!(1073741824.0);
    assert!(parse_snapshot(&snapshot.to_string()).is_ok());
}
