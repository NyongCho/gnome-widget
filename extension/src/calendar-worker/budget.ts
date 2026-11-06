import GLib from 'gi://GLib';

export type CalendarErrorCode = 'INVALID_DATA' | 'UNSUPPORTED_CALENDAR' | 'UNKNOWN_TIME_ZONE' |
    'PAYLOAD_TOO_LARGE' | 'EXPANSION_LIMIT';
export class CalendarFailure extends Error {
    constructor(readonly code: CalendarErrorCode) { super(code); this.name = 'CalendarFailure'; }
}
export interface EngineBudget { check(): void }
export function createBudget(deadlineUs: number): EngineBudget {
    return {check() {
        if (GLib.get_monotonic_time() >= deadlineUs) throw new CalendarFailure('EXPANSION_LIMIT');
    }};
}
export function invalid(): never { throw new CalendarFailure('INVALID_DATA'); }
