import ICAL from '../../vendor/ical/module.js';
import {setBudgetCheck} from '../../vendor/ical/budget.js';
import type {CalendarContext, CalendarData, CalendarEvent} from '../types.js';
import {CalendarFailure, invalid, type EngineBudget} from './budget.js';
import {nominal, one, parseComponent, parseWall, text, wallAt, type Component, type Property, type Wall} from './normalize.js';
import {Timezones, instantText, occurrenceKey, type Instant} from './timezones.js';

const MAX_OCCURRENCES = 10_000;
type Duration = {days: number; seconds: number};
type Span = {first: Instant; start: Property; duration: Duration};
type Series = {master: Component | null; overrides: Map<string, Component>};
type Range = readonly [number, number];
function cancelled(event: Component): boolean { return text(event, 'status') === 'CANCELLED'; }

function span(zones: Timezones, event: Component, context: CalendarContext, inherited?: Duration): Span {
    const start = one(event, 'dtstart');
    if (!start) invalid();
    const first = zones.property(start, context.timeZone);
    const endProperty = one(event, 'dtend'), durationProperty = one(event, 'duration');
    if (endProperty && durationProperty) invalid();
    let duration: Duration;
    if (endProperty) {
        const end = zones.property(endProperty, context.timeZone);
        if (end.wall.isDate !== first.wall.isDate || end.epoch < first.epoch) invalid();
        duration = first.wall.isDate
            ? {days: (nominal(end.wall) - nominal(first.wall)) / 86400, seconds: 0}
            : {days: 0, seconds: end.epoch - first.epoch};
    } else if (durationProperty) {
        const value = durationProperty.getFirstValue() as InstanceType<typeof ICAL.Duration>;
        if (value.isNegative || !/^P/.test(String(durationProperty.toJSON()[3]))) invalid();
        duration = {days: value.weeks * 7 + value.days, seconds: value.hours * 3600 + value.minutes * 60 + value.seconds};
        if (first.wall.isDate && duration.seconds) invalid();
    } else duration = inherited ?? {days: first.wall.isDate ? 1 : 0, seconds: 0};
    return {first, start, duration};
}
function endOf(zones: Timezones, start: Instant, duration: Duration, zone: string): Instant {
    let end = start;
    if (duration.days) end = zones.resolve(wallAt(nominal(start.wall) + duration.days * 86400, start.wall.isDate), zone);
    if (duration.seconds) end = zones.at(end.epoch + duration.seconds, zone);
    return end;
}
function windows(zones: Timezones, context: CalendarContext, now: string): Range[] {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(context.month) || !Number.isInteger(context.weekStart) || context.weekStart < 0 || context.weekStart > 6) invalid();
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(now)) invalid();
    parseWall(now.slice(0, 19));
    const current = Date.parse(now) / 1000;
    if (!Number.isFinite(current)) invalid();
    const first = parseWall(`${context.month}-01T00:00:00`);
    const next = {...first, year: first.month === 12 ? first.year + 1 : first.year, month: first.month % 12 + 1};
    const weekday = (wall: Wall) => new Date(nominal(wall) * 1000).getUTCDay();
    const left = wallAt(nominal(first) - (weekday(first) - context.weekStart + 7) % 7 * 86400);
    const right = wallAt(nominal(next) + (context.weekStart - weekday(next) + 7) % 7 * 86400);
    return [[zones.resolve(left, context.timeZone).epoch, zones.resolve(right, context.timeZone).epoch], [current, current + 30 * 86400]];
}
function overlaps(ranges: Range[], start: Instant, end: Instant): boolean {
    return ranges.some(([lo, hi]) => start.epoch < hi && (end.epoch === start.epoch ? start.epoch >= lo : end.epoch > lo));
}

export function expandCalendar(input: string, context: CalendarContext, now: string, budget: EngineBudget): CalendarData {
    setBudgetCheck(() => budget.check());
    try {
        budget.check();
        if (new TextEncoder().encode(input).length > 5 * 1024 * 1024) throw new CalendarFailure('PAYLOAD_TOO_LARGE');
        const root = parseComponent(input, budget);
        if (root.name !== 'vcalendar') invalid();
        const zones = new Timezones(root, budget), ranges = windows(zones, context, now);
        const windowEnd = Math.max(...ranges.map(range => range[1]));
        const groups = new Map<string, Series>();
        for (const event of root.getAllSubcomponents('vevent')) {
            budget.check();
            if (one(event, 'exrule')) throw new CalendarFailure('UNSUPPORTED_CALENDAR');
            const uid = text(event, 'uid');
            if (!uid) invalid();
            const group = groups.get(uid) ?? {master: null, overrides: new Map<string, Component>()};
            const rid = one(event, 'recurrence-id');
            if (rid) {
                if (rid.getParameter('range')) throw new CalendarFailure('UNSUPPORTED_CALENDAR');
                const key = occurrenceKey(zones.property(rid, context.timeZone));
                if (group.overrides.has(key)) throw new CalendarFailure('UNSUPPORTED_CALENDAR');
                group.overrides.set(key, event);
            } else {
                if (group.master) throw new CalendarFailure('UNSUPPORTED_CALENDAR');
                group.master = event;
            }
            groups.set(uid, group);
        }
        const result: {epoch: number; event: CalendarEvent}[] = [];
        let iterations = 0, expanded = 0;
        function emit(uid: string, key: string, start: Instant, value: Span, title: string): void {
            budget.check();
            const end = endOf(zones, start, value.duration, value.first.zone);
            if (overlaps(ranges, start, end)) result.push({epoch: start.epoch, event: {
                uid, occurrenceKey: key, title, start: instantText(start), end: instantText(end), allDay: start.wall.isDate,
            }});
            if (++expanded > MAX_OCCURRENCES) throw new CalendarFailure('EXPANSION_LIMIT');
        }
        for (const [uid, group] of groups) {
            budget.check();
            let inherited: Duration | undefined, title = '';
            if (group.master) {
                if (cancelled(group.master)) continue;
                const value = span(zones, group.master, context);
                inherited = value.duration;
                title = text(group.master, 'summary') ?? '';
                const starts = new Map<string, Instant>([[occurrenceKey(value.first), value.first]]);
                for (const property of group.master.getAllProperties('rrule')) {
                    const rule = (property.getFirstValue() as InstanceType<typeof ICAL.Recur>).clone();
                    const months = rule.parts.BYMONTH, days = rule.parts.BYMONTHDAY;
                    if (months?.length && days?.length && !months.some(month => days.some(day =>
                        day !== 0 && Math.abs(day) <= new Date(Date.UTC(2000, month, 0)).getUTCDate()))) invalid();
                    const count = rule.count;
                    const originalWall = parseWall(value.start.toJSON()[3]);
                    const original = new ICAL.Time(originalWall, ICAL.Timezone.utcTimezone);
                    const until = rule.until ? zones.resolve(rule.until, rule.until.zone === ICAL.Timezone.utcTimezone ? 'UTC' : value.first.zone).epoch : null;
                    rule.count = 0;
                    rule.until = new ICAL.Time(zones.at(windowEnd, value.first.zone).wall, ICAL.Timezone.utcTimezone);
                    const iterator = rule.iterator(original);
                    let emitted = value.first.gap && !value.first.wall.isDate ? 1 : 0;
                    while (!count || emitted < count) {
                        budget.check();
                        const candidate = iterator.next();
                        if (!candidate) break;
                        if (++iterations > 100_000) throw new CalendarFailure('EXPANSION_LIMIT');
                        const start = zones.resolve(candidate, value.first.zone);
                        if (until !== null && start.epoch > until || start.epoch >= windowEnd) break;
                        if (start.gap && !start.wall.isDate) continue;
                        emitted++;
                        if (overlaps(ranges, start, endOf(zones, start, value.duration, value.first.zone))) starts.set(occurrenceKey(start), start);
                        if (starts.size > MAX_OCCURRENCES) throw new CalendarFailure('EXPANSION_LIMIT');
                    }
                }
                for (const property of group.master.getAllProperties('rdate')) {
                    for (const raw of property.toJSON().slice(3)) {
                        budget.check();
                        const start = zones.property(property, context.timeZone, raw);
                        if (start.wall.isDate !== value.first.wall.isDate) invalid();
                        starts.set(occurrenceKey(start), start);
                        if (starts.size > MAX_OCCURRENCES) throw new CalendarFailure('EXPANSION_LIMIT');
                    }
                }
                const excluded = new Set<string>();
                for (const property of group.master.getAllProperties('exdate')) {
                    for (const raw of property.toJSON().slice(3)) {
                        budget.check(); excluded.add(occurrenceKey(zones.property(property, context.timeZone, raw)));
                    }
                }
                for (const [key, start] of starts) {
                    if (!excluded.has(key) && !group.overrides.has(key)) emit(uid, key, start, value, title);
                }
            }
            for (const [key, event] of group.overrides) {
                if (cancelled(event)) continue;
                const value = span(zones, event, context, inherited);
                emit(uid, key, value.first, value, text(event, 'summary') ?? title);
            }
        }
        result.sort((a, b) => a.epoch - b.epoch || (a.event.uid < b.event.uid ? -1 : a.event.uid > b.event.uid ? 1 :
            a.event.occurrenceKey < b.event.occurrenceKey ? -1 : a.event.occurrenceKey > b.event.occurrenceKey ? 1 : 0));
        budget.check();
        return {...context, events: result.map(value => value.event)};
    } catch (error) {
        if (error instanceof CalendarFailure) throw error;
        throw new CalendarFailure('INVALID_DATA');
    } finally { setBudgetCheck(() => {}); }
}
