import ICAL from '../../vendor/ical/module.js';
import {CalendarFailure, invalid, type EngineBudget} from './budget.js';

export type Component = InstanceType<typeof ICAL.Component>;
export type Property = InstanceType<typeof ICAL.Property>;
export type Wall = {year: number; month: number; day: number; hour: number; minute: number; second: number; isDate: boolean};

export function nominal(wall: Wall): number {
    const date = new Date(0);
    date.setUTCFullYear(wall.year, wall.month - 1, wall.day);
    date.setUTCHours(wall.hour, wall.minute, wall.second, 0);
    return date.getTime() / 1000;
}
export function wallAt(epoch: number, isDate = false): Wall {
    const date = new Date(epoch * 1000);
    return {year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(),
        hour: date.getUTCHours(), minute: date.getUTCMinutes(), second: date.getUTCSeconds(), isDate};
}
export function parseWall(value: unknown): Wall {
    if (typeof value !== 'string') invalid();
    const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})Z?)?$/.exec(value);
    if (!match) invalid();
    const wall: Wall = {year: Number(match[1]), month: Number(match[2]), day: Number(match[3]),
        hour: Number(match[4] ?? 0), minute: Number(match[5] ?? 0), second: Number(match[6] ?? 0), isDate: !match[4]};
    const check = wallAt(nominal(wall));
    if (wall.year < 1 || wall.year > 9999 || ['year', 'month', 'day', 'hour', 'minute', 'second'].some(
        field => wall[field as keyof Wall] !== check[field as keyof Wall])) invalid();
    return wall;
}
export function one(component: Component, name: string): Property | null {
    const properties = component.getAllProperties(name);
    if (properties.length > 1) invalid();
    return properties[0] ?? null;
}
export function text(component: Component, name: string): string | null {
    const property = one(component, name);
    return property ? String(property.getFirstValue()) : null;
}

/** Bounded unfolding and original-value validation precede any Time normalization. */
export function parseComponent(input: string, budget: EngineBudget): Component {
    const stack: unknown[][] = [];
    let root: unknown[] | null = null;
    let folded: string[] = [];
    function line(value: string): void {
        budget.check();
        if (!value) return;
        const begin = /^BEGIN:([A-Z0-9-]+)$/i.exec(value);
        const end = /^END:([A-Z0-9-]+)$/i.exec(value);
        if (begin) {
            if (stack.length >= 64) invalid();
            const node = [begin[1]!.toLowerCase(), [], []];
            if (stack.length) (stack.at(-1)![2] as unknown[][]).push(node);
            else if (root) invalid();
            else root = node;
            stack.push(node);
        } else if (end) {
            if (stack.at(-1)?.[0] !== end[1]!.toLowerCase()) invalid();
            stack.pop();
        } else {
            if (!stack.length) invalid();
            const property = ICAL.parse.property(value) as unknown[];
            if (property[0] === 'x-lic-error') {
                const warning = String(property[3]);
                if (!/^No value for (DESCRIPTION|LOCATION|SUMMARY) property\. Removing entire property(?::.*)?$/.test(warning)) invalid();
                return;
            }
            if (property[2] === 'date' || property[2] === 'date-time') {
                for (const item of property.slice(3)) parseWall(item);
            }
            // Preserve offset seconds, which ICAL.UtcOffset does not represent.
            if (property[0] === 'tzoffsetfrom' || property[0] === 'tzoffsetto') {
                property[2] = 'text'; property[3] = value.slice(value.indexOf(':') + 1);
            }
            if (property[0] === 'rdate' && property[2] === 'period') throw new CalendarFailure('UNSUPPORTED_CALENDAR');
            (stack.at(-1)![1] as unknown[][]).push(property);
        }
    }
    for (const part of input.split('\n')) {
        budget.check();
        const clean = part.endsWith('\r') ? part.slice(0, -1) : part;
        if (/^[ \t]/.test(clean) && folded.length) folded.push(clean.slice(1));
        else { line(folded.join('')); folded = [clean]; }
    }
    line(folded.join(''));
    if (stack.length || !root) invalid();
    return new ICAL.Component(root);
}
