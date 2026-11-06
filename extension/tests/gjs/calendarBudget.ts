import GLib from 'gi://GLib';
import System from 'system';
import {expandCalendar} from '../../src/calendar-worker/engine.js';
import {createBudget, CalendarFailure} from '../../src/calendar-worker/budget.js';

const rule = ARGV[0] === 'sparse'
    ? 'DTSTART:20240229T000000Z\nRRULE:FREQ=SECONDLY;BYMONTH=2;BYMONTHDAY=29;BYHOUR=0;BYMINUTE=0;BYSECOND=0;UNTIL=20261231T235959Z'
    : 'DTSTART:20260201T000000Z\nRRULE:FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30';
const input = `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:budget\n${rule}\nEND:VEVENT\nEND:VCALENDAR\n`;
const start = GLib.get_monotonic_time();
let success = false;
try {
    expandCalendar(input, {month: '2026-11', timeZone: 'UTC', weekStart: 1}, '2026-11-01T00:00:00Z', createBudget(start + 100_000));
} catch (error) {
    success = error instanceof CalendarFailure && (error.code === 'EXPANSION_LIMIT' ||
        ARGV[0] === 'impossible' && error.code === 'INVALID_DATA');
}
const elapsedMs = (GLib.get_monotonic_time() - start) / 1000;
print(JSON.stringify({name: ARGV[0], success, elapsedMs}));
System.exit(success && elapsedMs < 300 ? 0 : 1);
