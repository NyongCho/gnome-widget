//! Test-only oracle; never included in the extension.
use liquid_widgets_daemon::{providers::calendar::expand_ics, types::CalendarContext};
use std::io::{self, BufRead};
fn main() {
    for line in io::stdin().lock().lines() {
        let value: serde_json::Value = serde_json::from_str(&line.unwrap()).unwrap();
        let context: CalendarContext = serde_json::from_value(value["context"].clone()).unwrap();
        let result = expand_ics(
            value["ics"].as_str().unwrap(),
            &context,
            value["now"].as_str().unwrap(),
        );
        let output = match result {
            Ok(events) => serde_json::json!({"name":value["name"],"events":events}),
            Err(error) => serde_json::json!({"name":value["name"],"error":format!("{error:?}")}),
        };
        println!("{output}");
    }
}
