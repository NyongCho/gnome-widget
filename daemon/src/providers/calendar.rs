mod native;

use crate::types::{CalendarContext, CalendarEvent};
use chrono::{DateTime, Datelike, Days, FixedOffset, NaiveDate, SecondsFormat, TimeZone};
use native::{Event, Property, Root, Time};
use std::collections::{BTreeMap, BTreeSet};

pub const MAX_ICS_BYTES: usize = 5 * 1024 * 1024;
pub const MAX_OCCURRENCES: usize = 10_000;
const MAX_ITERATIONS: usize = 100_000;

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum CalendarError {
    #[error("invalid calendar data")]
    InvalidCalendar,
    #[error("unsupported calendar feature")]
    UnsupportedCalendar,
    #[error("unknown time zone")]
    UnknownTimeZone,
    #[error("invalid calendar context")]
    InvalidContext,
    #[error("calendar input exceeds size limit")]
    InputLimit,
    #[error("calendar expansion exceeds limit")]
    ExpansionLimit,
}
impl Time {
    fn date_value(self) -> Result<NaiveDate, CalendarError> {
        NaiveDate::from_ymd_opt(self.year, self.month as u32, self.day as u32)
            .ok_or(CalendarError::InvalidCalendar)
    }
    fn text(self) -> Result<String, CalendarError> {
        if self.date != 0 {
            return Ok(self.date_value()?.to_string());
        }
        let offset = FixedOffset::east_opt(self.offset).ok_or(CalendarError::InvalidCalendar)?;
        Ok(offset
            .timestamp_opt(self.epoch, 0)
            .single()
            .ok_or(CalendarError::InvalidCalendar)?
            .to_rfc3339())
    }
    fn key(self) -> Result<String, CalendarError> {
        if self.date != 0 {
            return self.text();
        }
        Ok(DateTime::from_timestamp(self.epoch, 0)
            .ok_or(CalendarError::InvalidCalendar)?
            .to_rfc3339_opts(SecondsFormat::Secs, true))
    }
}
fn time(root: &Root, value: &str, zone: &str) -> Result<Time, CalendarError> {
    // Validate the original representation: libical can normalize malformed dates.
    let (date, rest) = value
        .split_at_checked(8)
        .ok_or(CalendarError::InvalidCalendar)?;
    NaiveDate::parse_from_str(date, "%Y%m%d").map_err(|_| CalendarError::InvalidCalendar)?;
    if !rest.is_empty() {
        let local = rest.strip_suffix('Z').unwrap_or(rest);
        if local.len() != 7
            || !local.starts_with('T')
            || chrono::NaiveTime::parse_from_str(&local[1..], "%H%M%S").is_err()
        {
            return Err(CalendarError::InvalidCalendar);
        }
    }
    root.time(value, zone)
}
fn zone<'a>(p: &'a Property, context: &'a CalendarContext) -> &'a str {
    if p.value.ends_with('Z') {
        "UTC"
    } else {
        p.tzid.as_deref().unwrap_or(&context.time_zone)
    }
}
fn property_time(
    root: &Root,
    p: &Property,
    context: &CalendarContext,
) -> Result<Time, CalendarError> {
    time(root, &p.value, zone(p, context))
}
#[derive(Clone, Copy)]
struct Duration {
    days: i64,
    seconds: i64,
}
impl Duration {
    fn end(self, root: &Root, start: Time, zone: &str) -> Result<Time, CalendarError> {
        let mut end = start;
        if self.days != 0 {
            let date = start
                .date_value()?
                .checked_add_days(Days::new(self.days as u64))
                .ok_or(CalendarError::InvalidCalendar)?;
            let value = if start.date != 0 {
                date.format("%Y%m%d").to_string()
            } else {
                format!(
                    "{}T{:02}{:02}{:02}",
                    date.format("%Y%m%d"),
                    start.hour,
                    start.minute,
                    start.second
                )
            };
            end = time(root, &value, zone)?;
        }
        if self.seconds != 0 {
            end = root.at(
                end.epoch
                    .checked_add(self.seconds)
                    .ok_or(CalendarError::InvalidCalendar)?,
                zone,
            )?;
        }
        Ok(end)
    }
}
struct Span {
    start: Property,
    first: Time,
    duration: Duration,
}
fn span(
    root: &Root,
    event: &Event<'_>,
    context: &CalendarContext,
    inherited: Option<Duration>,
) -> Result<Span, CalendarError> {
    let start = event
        .one("DTSTART")?
        .ok_or(CalendarError::InvalidCalendar)?;
    let first = property_time(root, &start, context)?;
    let end = event.one("DTEND")?;
    let duration = event.one("DURATION")?;
    if end.is_some() && duration.is_some() {
        return Err(CalendarError::InvalidCalendar);
    }
    let duration = if let Some(end) = end {
        let end = property_time(root, &end, context)?;
        if end.date != first.date || end.epoch < first.epoch {
            return Err(CalendarError::InvalidCalendar);
        }
        if first.date != 0 {
            Duration {
                days: (end.date_value()? - first.date_value()?).num_days(),
                seconds: 0,
            }
        } else {
            Duration {
                days: 0,
                seconds: end.epoch - first.epoch,
            }
        }
    } else if let Some(duration) = duration {
        let (days, seconds) = native::duration(&duration.value)?;
        if first.date != 0 && seconds != 0 {
            return Err(CalendarError::InvalidCalendar);
        }
        Duration { days, seconds }
    } else {
        inherited.unwrap_or(Duration {
            days: i64::from(first.date != 0),
            seconds: 0,
        })
    };
    Ok(Span {
        start,
        first,
        duration,
    })
}
struct Window {
    ranges: [(i64, i64); 2],
}
impl Window {
    fn new(root: &Root, context: &CalendarContext, now: &str) -> Result<Self, CalendarError> {
        if context.week_start > 6 || context.month.len() != 7 {
            return Err(CalendarError::InvalidContext);
        }
        let first = NaiveDate::parse_from_str(&format!("{}-01", context.month), "%Y-%m-%d")
            .map_err(|_| CalendarError::InvalidContext)?;
        let next = first
            .checked_add_months(chrono::Months::new(1))
            .ok_or(CalendarError::InvalidContext)?;
        let before =
            (first.weekday().num_days_from_sunday() + 7 - u32::from(context.week_start)) % 7;
        let after = (u32::from(context.week_start) + 7 - next.weekday().num_days_from_sunday()) % 7;
        let left = first
            .checked_sub_days(Days::new(before.into()))
            .ok_or(CalendarError::InvalidContext)?;
        let right = next
            .checked_add_days(Days::new(after.into()))
            .ok_or(CalendarError::InvalidContext)?;
        let midnight = |date: NaiveDate| {
            time(
                root,
                &date.format("%Y%m%dT000000").to_string(),
                &context.time_zone,
            )
            .map(|t| t.epoch)
        };
        let now = DateTime::parse_from_rfc3339(now)
            .map_err(|_| CalendarError::InvalidContext)?
            .timestamp();
        let later = now
            .checked_add(30 * 86400)
            .ok_or(CalendarError::InvalidContext)?;
        Ok(Self {
            ranges: [(midnight(left)?, midnight(right)?), (now, later)],
        })
    }
    fn end(&self) -> i64 {
        self.ranges.iter().map(|r| r.1).max().unwrap()
    }
    fn contains(&self, start: Time, end: Time) -> bool {
        self.ranges.iter().any(|&(lo, hi)| {
            start.epoch < hi
                && if end.epoch == start.epoch {
                    start.epoch >= lo
                } else {
                    end.epoch > lo
                }
        })
    }
}
#[derive(Default)]
struct Series<'a> {
    master: Option<Event<'a>>,
    overrides: BTreeMap<String, Event<'a>>,
}
fn cancelled(event: &Event<'_>) -> Result<bool, CalendarError> {
    Ok(event.one("STATUS")?.is_some_and(|p| p.value == "CANCELLED"))
}
fn make_event(
    root: &Root,
    uid: &str,
    key: String,
    start: Time,
    span: &Span,
    context: &CalendarContext,
    default_title: &str,
) -> Result<(Time, CalendarEvent), CalendarError> {
    let end = span.duration.end(root, start, zone(&span.start, context))?;
    Ok((
        end,
        CalendarEvent {
            uid: uid.into(),
            occurrence_key: key,
            title: default_title.into(),
            start: start.text()?,
            end: end.text()?,
            all_day: start.date != 0,
        },
    ))
}

/// Expand a bounded month-grid + upcoming-30-day view. Returns an error instead
/// of a truncated calendar. No I/O or wall clock access; caller owns scheduling.
pub fn expand_ics(
    input: &str,
    context: &CalendarContext,
    now: &str,
) -> Result<Vec<CalendarEvent>, CalendarError> {
    if input.len() > MAX_ICS_BYTES {
        return Err(CalendarError::InputLimit);
    }
    let _guard = native::LIBICAL_LOCK
        .lock()
        .map_err(|_| CalendarError::InvalidCalendar)?;
    let root = Root::parse(input)?;
    let window = Window::new(&root, context, now)?;
    let mut series: BTreeMap<String, Series<'_>> = BTreeMap::new();
    for event in root.events() {
        if event.one("EXRULE")?.is_some() {
            return Err(CalendarError::UnsupportedCalendar);
        }
        let uid = event
            .one("UID")?
            .filter(|p| !p.value.is_empty())
            .ok_or(CalendarError::InvalidCalendar)?
            .value;
        let group = series.entry(uid).or_default();
        if let Some(rid) = event.one("RECURRENCE-ID")? {
            if rid.range.is_some() {
                return Err(CalendarError::UnsupportedCalendar);
            }
            let key = property_time(&root, &rid, context)?.key()?;
            if group.overrides.insert(key, event).is_some() {
                return Err(CalendarError::UnsupportedCalendar);
            }
        } else if group.master.replace(event).is_some() {
            return Err(CalendarError::UnsupportedCalendar);
        }
    }
    let mut result: Vec<(i64, CalendarEvent)> = Vec::new();
    let mut iterations = 0;
    let mut expanded = 0;
    for (uid, group) in series {
        let mut inherited = None;
        let mut title = String::new();
        if let Some(ref master) = group.master {
            if cancelled(master)? {
                continue;
            }
            let span = span(&root, master, context, None)?;
            inherited = Some(span.duration);
            title = master.one("SUMMARY")?.map_or(String::new(), |p| p.value);
            let mut starts = BTreeMap::new();
            starts.insert(span.first.key()?, span.first);
            for rule in master.properties("RRULE")? {
                for start in root.recur(
                    &rule.value,
                    &span.start.value,
                    zone(&span.start, context),
                    window.end(),
                )? {
                    iterations += 1;
                    if iterations > MAX_ITERATIONS {
                        return Err(CalendarError::ExpansionLimit);
                    }
                    let Some(start) = start else {
                        continue;
                    };
                    if start.epoch >= window.end() {
                        break;
                    }
                    let end = span
                        .duration
                        .end(&root, start, zone(&span.start, context))?;
                    if window.contains(start, end) {
                        starts.insert(start.key()?, start);
                    }
                    if starts.len() > MAX_OCCURRENCES {
                        return Err(CalendarError::ExpansionLimit);
                    }
                }
            }
            for dates in master.properties("RDATE")? {
                for value in dates.value.split(',') {
                    if value.contains('/') {
                        return Err(CalendarError::UnsupportedCalendar);
                    }
                    let start = time(&root, value, zone(&dates, context))?;
                    if start.date != span.first.date {
                        return Err(CalendarError::InvalidCalendar);
                    }
                    starts.insert(start.key()?, start);
                    if starts.len() > MAX_OCCURRENCES {
                        return Err(CalendarError::ExpansionLimit);
                    }
                }
            }
            let mut excluded = BTreeSet::new();
            for dates in master.properties("EXDATE")? {
                for value in dates.value.split(',') {
                    excluded.insert(time(&root, value, zone(&dates, context))?.key()?);
                }
            }
            for (key, start) in starts {
                if excluded.contains(&key) || group.overrides.contains_key(&key) {
                    continue;
                }
                let (end, event) = make_event(&root, &uid, key, start, &span, context, &title)?;
                if window.contains(start, end) {
                    result.push((start.epoch, event));
                }
                expanded += 1;
                if expanded > MAX_OCCURRENCES {
                    return Err(CalendarError::ExpansionLimit);
                }
            }
        }
        // Detached instances are considered independently: a moved occurrence
        // may enter the window even when its original date lies outside it.
        for (key, event) in group.overrides {
            if cancelled(&event)? {
                continue;
            }
            let span = span(&root, &event, context, inherited)?;
            let title = event
                .one("SUMMARY")?
                .map_or_else(|| title.clone(), |p| p.value);
            let (end, dto) = make_event(&root, &uid, key, span.first, &span, context, &title)?;
            if window.contains(span.first, end) {
                result.push((span.first.epoch, dto));
            }
            expanded += 1;
            if expanded > MAX_OCCURRENCES {
                return Err(CalendarError::ExpansionLimit);
            }
        }
    }
    result.sort_by(|a, b| {
        (&a.0, &a.1.uid, &a.1.occurrence_key).cmp(&(&b.0, &b.1.uid, &b.1.occurrence_key))
    });
    Ok(result.into_iter().map(|(_, event)| event).collect())
}
