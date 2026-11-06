//! Test oracle only. Never packaged or called by the public extension.
use liquid_widgets_daemon::{
    providers::calendar::{CalendarError, expand_ics},
    types::CalendarContext,
};
use std::io::{self, BufRead};
fn main() {
    for line in io::stdin().lock().lines() {
        let case: serde_json::Value = serde_json::from_str(&line.unwrap()).unwrap();
        let context: CalendarContext = serde_json::from_value(case["context"].clone()).unwrap();
        let result = expand_ics(
            case["ics"].as_str().unwrap(),
            &context,
            case["now"].as_str().unwrap(),
        );
        let output = match result {
            Ok(events) => serde_json::json!({"name":case["name"],"data":{
                "month":context.month,"timeZone":context.time_zone,"weekStart":context.week_start,"events":events}}),
            Err(error) => {
                let code = match error {
                    CalendarError::InvalidCalendar | CalendarError::InvalidContext => {
                        "INVALID_DATA"
                    }
                    CalendarError::UnsupportedCalendar => "UNSUPPORTED_CALENDAR",
                    CalendarError::UnknownTimeZone => "UNKNOWN_TIME_ZONE",
                    CalendarError::InputLimit => "PAYLOAD_TOO_LARGE",
                    CalendarError::ExpansionLimit => "EXPANSION_LIMIT",
                };
                serde_json::json!({"name":case["name"],"errorCode":code})
            }
        };
        println!("{output}");
    }
}
