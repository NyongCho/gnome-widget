mod support;

use liquid_widgets_daemon::providers::calendar::expand_ics;
use support::seoul_november;

#[test]
fn weekly_exdate_has_two_occurrences() {
    let events = expand_ics(
        include_str!("../../tests/fixtures/calendar/weekly-exdate.ics"),
        &seoul_november(),
        "2026-11-03T12:00:00+09:00",
    )
    .unwrap();
    assert_eq!(
        events.iter().map(|e| e.start.as_str()).collect::<Vec<_>>(),
        ["2026-11-02T09:00:00+09:00", "2026-11-16T09:00:00+09:00"]
    );
}

fn fixture(
    name: &str,
    context: &liquid_widgets_daemon::types::CalendarContext,
) -> Result<
    Vec<liquid_widgets_daemon::types::CalendarEvent>,
    liquid_widgets_daemon::providers::calendar::CalendarError,
> {
    let input = std::fs::read_to_string(format!(
        "{}/../tests/fixtures/calendar/{name}.ics",
        env!("CARGO_MANIFEST_DIR")
    ))
    .unwrap();
    expand_ics(&input, context, "2026-11-03T12:00:00+09:00")
}
#[test]
fn moved_occurrence_replaces_original() {
    let events = fixture("moved", &seoul_november()).unwrap();
    assert_eq!(events.len(), 3);
    assert_eq!(events[1].start, "2026-11-10T14:00:00+09:00");
    assert_eq!(events[1].title, "Moved");
    assert_eq!(events[1].occurrence_key, "2026-11-09T00:00:00Z");
}
#[test]
fn cancelled_occurrence_is_absent() {
    let events = fixture("cancelled", &seoul_november()).unwrap();
    assert_eq!(events.len(), 2);
    assert!(events.iter().all(|e| !e.start.starts_with("2026-11-09")));
    assert!(
        fixture("master-cancelled", &seoul_november())
            .unwrap()
            .is_empty()
    );
}
#[test]
fn rdate_adds_and_exdate_removes() {
    let events = fixture("rdate", &seoul_november()).unwrap();
    assert_eq!(
        events.iter().map(|e| e.start.as_str()).collect::<Vec<_>>(),
        ["2026-11-02T00:00:00+00:00", "2026-11-09T00:00:00+00:00"]
    );
}
#[test]
fn all_day_end_is_exclusive() {
    let events = fixture("all-day", &seoul_november()).unwrap();
    assert!(events[0].all_day);
    assert_eq!(
        (&*events[0].start, &*events[0].end),
        ("2026-11-04", "2026-11-07")
    );
    assert_eq!(
        (&*events[1].start, &*events[1].end),
        ("2026-11-11", "2026-11-14")
    );
}
#[test]
fn dst_keeps_local_start() {
    let events = fixture(
        "dst",
        &liquid_widgets_daemon::types::CalendarContext {
            month: "2026-10".into(),
            time_zone: "America/New_York".into(),
            week_start: 1,
        },
    )
    .unwrap();
    assert_eq!(
        events.iter().map(|e| e.start.as_str()).collect::<Vec<_>>(),
        [
            "2026-10-25T09:00:00-04:00",
            "2026-11-01T09:00:00-05:00",
            "2026-11-08T09:00:00-05:00"
        ]
    );
}
#[test]
fn ongoing_event_overlaps_window() {
    let events = fixture("ongoing", &seoul_november()).unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].uid, "ongoing");
}
#[test]
fn custom_vtimezone_is_resolved() {
    assert_eq!(
        fixture("custom-zone", &seoul_november()).unwrap()[0].start,
        "2026-11-04T09:00:00+05:30"
    );
}
#[test]
fn floating_time_uses_requested_zone() {
    assert_eq!(
        fixture("floating", &seoul_november()).unwrap()[0].start,
        "2026-11-04T09:00:00+09:00"
    );
}
#[test]
fn unknown_zone_is_an_error() {
    assert!(fixture("unknown-zone", &seoul_november()).is_err());
}
#[test]
fn expansion_limit_returns_error() {
    assert!(fixture("dense", &seoul_november()).is_err());
}
#[test]
fn input_limit_and_invalid_context_are_errors() {
    assert!(
        expand_ics(
            &" ".repeat(5 * 1024 * 1024 + 1),
            &seoul_november(),
            "2026-11-03T12:00:00+09:00"
        )
        .is_err()
    );
    let mut context = seoul_november();
    context.week_start = 7;
    assert!(fixture("floating", &context).is_err());
    context.week_start = 1;
    context.month = "2026-13".into();
    assert!(fixture("floating", &context).is_err());
    assert!(
        expand_ics(
            "BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR",
            &seoul_november(),
            "no-offset"
        )
        .is_err()
    );
}
#[test]
fn nominal_day_duration_crosses_dst() {
    let events = fixture("duration", &seoul_november()).unwrap();
    assert_eq!(events[0].end, "2026-11-01T09:00:00-05:00");
    assert_eq!(events[1].end, "2026-11-02T09:00:00-05:00");
}
#[test]
fn default_end_matches_ical_rules() {
    let events = fixture("default-end", &seoul_november()).unwrap();
    assert_eq!(events[0].end, "2026-11-05");
    assert_eq!(events[1].end, events[1].start);
}
#[test]
fn unsupported_range_is_explicit_error() {
    assert!(fixture("range", &seoul_november()).is_err());
}

fn expand_event(
    body: &str,
) -> Result<
    Vec<liquid_widgets_daemon::types::CalendarEvent>,
    liquid_widgets_daemon::providers::calendar::CalendarError,
> {
    expand_ics(
        &format!(
            "BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:boundary\n{body}\nEND:VEVENT\nEND:VCALENDAR\n"
        ),
        &seoul_november(),
        "2026-11-03T12:00:00+09:00",
    )
}
#[test]
fn all_day_grid_end_boundary_is_exclusive_in_context_zone() {
    // November's Monday-start grid ends December 7, 00:00 in Seoul.
    assert!(
        expand_event("DTSTART;VALUE=DATE:20261207\nDTEND;VALUE=DATE:20261208")
            .unwrap()
            .is_empty()
    );
    assert!(
        expand_event("DTSTART;VALUE=DATE:20261025\nDTEND;VALUE=DATE:20261026")
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        expand_event("DTSTART;VALUE=DATE:20261206\nDTEND;VALUE=DATE:20261207")
            .unwrap()
            .len(),
        1
    );
}
#[test]
fn invalid_dates_and_unsupported_periods_are_not_normalized() {
    assert!(expand_event("DTSTART:20261131T090000Z").is_err());
    assert!(
        expand_event(
            "DTSTART:20261103T090000Z\nRDATE;VALUE=PERIOD:20261104T090000Z/20261104T100000Z"
        )
        .is_err()
    );
    assert!(expand_event("DTSTART:20261103T090000Z\nRRULE:FREQ=NONEXISTENT").is_err());
}
#[test]
fn unbounded_recurrence_stops_at_window_end() {
    let events = expand_event("DTSTART:20261101T090000Z\nRRULE:FREQ=DAILY").unwrap();
    assert_eq!(events.len(), 36);
    assert!(events.last().unwrap().start.starts_with("2026-12-06"));
}
#[test]
fn duplicate_rdates_and_multiple_exdates_are_deduplicated() {
    let events = expand_event("DTSTART:20261101T090000Z\nRRULE:FREQ=DAILY;COUNT=4\nRDATE:20261102T090000Z,20261102T090000Z\nEXDATE:20261103T090000Z,20261104T090000Z").unwrap();
    assert_eq!(events.len(), 2);
}
#[test]
fn recurrence_in_a_dst_gap_skips_nonexistent_local_time() {
    let input = "BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:gap\nDTSTART;TZID=America/New_York:20260307T023000\nDURATION:PT1H\nRRULE:FREQ=DAILY;COUNT=3\nEND:VEVENT\nEND:VCALENDAR\n";
    let context = liquid_widgets_daemon::types::CalendarContext {
        month: "2026-03".into(),
        time_zone: "America/New_York".into(),
        week_start: 1,
    };
    let events = expand_ics(input, &context, "2026-03-01T00:00:00-05:00").unwrap();
    assert_eq!(
        events.iter().map(|e| e.start.as_str()).collect::<Vec<_>>(),
        [
            "2026-03-07T02:30:00-05:00",
            "2026-03-09T02:30:00-04:00",
            "2026-03-10T02:30:00-04:00"
        ]
    );
}
#[test]
fn ambiguous_local_time_uses_first_occurrence() {
    let events =
        expand_event("DTSTART;TZID=America/New_York:20261101T013000\nDURATION:PT1H").unwrap();
    assert_eq!(events[0].start, "2026-11-01T01:30:00-04:00");
    assert_eq!(events[0].end, "2026-11-01T01:30:00-05:00");
}
#[test]
fn utc_until_is_inclusive_for_local_recurrence() {
    let events = expand_event(
        "DTSTART;TZID=America/New_York:20261101T090000\nRRULE:FREQ=DAILY;UNTIL=20261103T140000Z",
    )
    .unwrap();
    assert_eq!(events.len(), 3);
    assert_eq!(events[2].start, "2026-11-03T09:00:00-05:00");
}
#[test]
fn historical_iteration_budget_returns_error_without_partial_results() {
    use liquid_widgets_daemon::providers::calendar::CalendarError;
    assert_eq!(
        expand_event("DTSTART:20200101T000000Z\nRRULE:FREQ=SECONDLY").unwrap_err(),
        CalendarError::ExpansionLimit
    );
}
#[test]
fn explicit_gap_start_uses_pre_gap_offset_and_counts_as_first_occurrence() {
    let context = liquid_widgets_daemon::types::CalendarContext {
        month: "2026-03".into(),
        time_zone: "America/New_York".into(),
        week_start: 1,
    };
    let events = expand_ics(
        include_str!("../../tests/fixtures/calendar/gap-start.ics"),
        &context,
        "2026-03-01T00:00:00-05:00",
    )
    .unwrap();
    assert_eq!(events[0].start, "2026-03-08T03:30:00-04:00");
    assert_eq!(events[0].end, "2026-03-08T04:30:00-04:00");
    assert_eq!(events.len(), 3);
    assert_eq!(events[1].start, "2026-03-09T02:30:00-04:00");
    assert_eq!(events[2].start, "2026-03-10T02:30:00-04:00");
}
#[test]
fn all_day_dates_survive_midnight_offset_transition() {
    let context = liquid_widgets_daemon::types::CalendarContext {
        month: "2026-09".into(),
        time_zone: "America/Santiago".into(),
        week_start: 1,
    };
    let events = expand_ics(
        include_str!("../../tests/fixtures/calendar/midnight-gap.ics"),
        &context,
        "2026-09-01T00:00:00-04:00",
    )
    .unwrap();
    assert_eq!(events[0].start, "2026-09-06");
    assert_eq!(events[0].occurrence_key, "2026-09-06");
    assert_eq!(events[0].end, "2026-09-07");
}
#[test]
fn non_dst_offset_fold_uses_first_occurrence() {
    let events = expand_ics(
        include_str!("../../tests/fixtures/calendar/custom-fold.ics"),
        &seoul_november(),
        "2026-11-03T12:00:00+09:00",
    )
    .unwrap();
    assert_eq!(events[0].start, "2026-11-01T01:30:00+04:00");
    assert_eq!(events[0].end, "2026-11-01T01:30:00+03:00");
}
#[test]
fn explicit_gap_start_consumes_count_once() {
    let context = liquid_widgets_daemon::types::CalendarContext {
        month: "2026-03".into(),
        time_zone: "America/New_York".into(),
        week_start: 1,
    };
    let events = expand_ics(
        include_str!("../../tests/fixtures/calendar/gap-start.ics"),
        &context,
        "2026-03-01T00:00:00-05:00",
    )
    .unwrap();
    assert_eq!(events.len(), 3);
}
