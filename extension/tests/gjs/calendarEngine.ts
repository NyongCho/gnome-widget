import GLib from 'gi://GLib';
import System from 'system';
import {expandCalendar} from '../../src/calendar-worker/engine.js';
import {createBudget, CalendarFailure} from '../../src/calendar-worker/budget.js';

const cases = JSON.parse(new TextDecoder().decode(GLib.file_get_contents(ARGV[0]!)[1]));
let failed = false;
for (const input of cases) {
    const ics = typeof input.ics === 'string' ? input.ics : input.ics.repeat.repeat(input.ics.count);
    try {
        const data = expandCalendar(ics, input.context, input.now, createBudget(GLib.get_monotonic_time() + 9_000_000));
        print(JSON.stringify({name: input.name, data}));
    } catch (error) {
        if (!(error instanceof CalendarFailure)) failed = true;
        print(JSON.stringify({name: input.name, errorCode: error instanceof CalendarFailure ? error.code : 'UNEXPECTED_ERROR'}));
    }
}
System.exit(failed ? 1 : 0);
