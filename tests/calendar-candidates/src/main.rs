use rrule::RRuleSet;
fn main() {
    let fixture = include_str!("../../fixtures/calendar/custom-zone.ics");
    let parsed = ical::IcalParser::new(fixture.as_bytes()).next().unwrap().unwrap();
    assert_eq!(parsed.timezones.len(), 1);
    assert_eq!(parsed.events.len(), 1);
    println!("ical 0.11.0: custom VTIMEZONE syntax parsed (no recurrence engine)");
    let basic: RRuleSet = "DTSTART;TZID=Asia/Seoul:20261102T090000\nRRULE:FREQ=WEEKLY;COUNT=3\nEXDATE;TZID=Asia/Seoul:20261109T090000".parse().unwrap();
    assert_eq!(basic.all(10).dates.len(), 2);
    println!("rrule 0.14.0: IANA weekly recurrence + EXDATE passed");
    let custom = "DTSTART;TZID=Custom/Office:20261104T090000\nRRULE:FREQ=WEEKLY;COUNT=3".parse::<RRuleSet>();
    assert!(custom.is_err(), "Re-evaluate libical choice if custom zones become supported");
    println!("rrule 0.14.0: custom TZID unsupported; requires another timezone engine");
}
