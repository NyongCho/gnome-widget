//! All IPC JSON is checked against the same schemas compiled for GJS.
//! Errors deliberately contain no input values, URLs, or serde diagnostics.
use crate::types::{CalendarContext, ProviderName, Settings, Snapshot, WeatherLocation};
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use std::{collections::BTreeMap, sync::LazyLock};

pub const MAX_PAYLOAD_BYTES: usize = 512 * 1024;
const SNAPSHOT_ID: &str = "urn:liquid-widgets:snapshot:v1";
const SETTINGS_ID: &str = "urn:liquid-widgets:settings:v1";
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
#[error("invalid protocol payload")]
pub struct ValidationError;
static VALIDATORS: LazyLock<BTreeMap<&str, jsonschema::Validator>> = LazyLock::new(|| {
    let snapshot: Value = serde_json::from_str(include_str!("../../protocol/snapshot.schema.json"))
        .expect("embedded snapshot schema is JSON");
    let settings: Value = serde_json::from_str(include_str!("../../protocol/settings.schema.json"))
        .expect("embedded settings schema is JSON");
    let registry = jsonschema::Registry::new()
        .add(SNAPSHOT_ID, snapshot)
        .expect("snapshot URI")
        .add(SETTINGS_ID, settings)
        .expect("settings URI")
        .prepare()
        .expect("embedded schema registry");
    let definitions = [
        ("snapshot", SNAPSHOT_ID.to_string()),
        ("settings", SETTINGS_ID.to_string()),
        (
            "calendarContext",
            format!("{SNAPSHOT_ID}#/$defs/CalendarContext"),
        ),
        (
            "weatherLocation",
            format!("{SETTINGS_ID}#/$defs/WeatherLocationInput"),
        ),
        (
            "locationSearchResults",
            format!("{SETTINGS_ID}#/$defs/LocationSearchResults"),
        ),
        ("calendar", format!("{SNAPSHOT_ID}#/$defs/CalendarState")),
        ("weather", format!("{SNAPSHOT_ID}#/$defs/WeatherState")),
        ("system", format!("{SNAPSHOT_ID}#/$defs/SystemState")),
        ("network", format!("{SNAPSHOT_ID}#/$defs/NetworkState")),
        ("media", format!("{SNAPSHOT_ID}#/$defs/MediaState")),
    ];
    definitions
        .into_iter()
        .map(|(name, reference)| {
            let validator = jsonschema::draft202012::options()
                .with_registry(&registry)
                .should_validate_formats(true)
                .build(&json!({"$ref":reference}))
                .expect("embedded schema compiles");
            (name, validator)
        })
        .collect()
});
fn validate(input: &str, name: &str) -> Result<Value, ValidationError> {
    if input.len() > MAX_PAYLOAD_BYTES {
        return Err(ValidationError);
    }
    let value: Value = serde_json::from_str(input).map_err(|_| ValidationError)?;
    if !VALIDATORS[name].is_valid(&value) {
        return Err(ValidationError);
    }
    Ok(value)
}
fn parse<T: DeserializeOwned>(input: &str, name: &str) -> Result<T, ValidationError> {
    let mut value = validate(input, name)?;
    // JSON Schema's integer includes 1.0. Align serde integer DTOs with GJS
    // numbers after schema validation, without losing fractional values.
    normalize_integral_numbers(&mut value);
    serde_json::from_value(value).map_err(|_| ValidationError)
}
pub fn parse_snapshot(input: &str) -> Result<Snapshot, ValidationError> {
    parse(input, "snapshot")
}
pub fn parse_settings(input: &str) -> Result<Settings, ValidationError> {
    parse(input, "settings")
}
pub fn parse_calendar_context(input: &str) -> Result<CalendarContext, ValidationError> {
    parse(input, "calendarContext")
}
pub fn parse_weather_location(input: &str) -> Result<Option<WeatherLocation>, ValidationError> {
    parse(input, "weatherLocation")
}
pub fn parse_location_search_results(input: &str) -> Result<Vec<WeatherLocation>, ValidationError> {
    parse(input, "locationSearchResults")
}
pub fn validate_provider_state(name: ProviderName, input: &str) -> Result<Value, ValidationError> {
    validate(input, name.as_str())
}

fn normalize_integral_numbers(value: &mut Value) {
    match value {
        Value::Number(number) if number.is_f64() => {
            if let Some(n) = number.as_f64()
                && n.fract() == 0.0
                && n.abs() <= 9_007_199_254_740_991.0
            {
                *value = Value::from(n as i64);
            }
        }
        Value::Array(items) => items.iter_mut().for_each(normalize_integral_numbers),
        Value::Object(fields) => fields.values_mut().for_each(normalize_integral_numbers),
        _ => {}
    }
}
