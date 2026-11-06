import ICAL from '../../vendor/ical/module.js';
import zoneData from '../../vendor/timezones/zones.json' with {type: 'json'};
import {CalendarFailure, invalid, type EngineBudget} from './budget.js';
import {nominal, one, parseComponent, parseWall, text, wallAt, type Component, type Property, type Wall} from './normalize.js';

type Transition = {at: number; before: number; after: number};
export type Instant = {epoch: number; wall: Wall; zone: string; offset: number; gap: boolean};
function offset(value: string | null): number {
    const match = /^([+-])(\d{2}):?(\d{2})(?::?(\d{2}))?$/.exec(value ?? '');
    if (!match || Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4] ?? 0) > 59) invalid();
    return (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 3600 + Number(match[3]) * 60 + Number(match[4] ?? 0));
}
class Zone {
    private until = 0;
    private transitions: Transition[] = [];
    readonly offsets: number[];
    constructor(private component: Component, private budget: EngineBudget) {
        this.offsets = [...new Set(component.getAllSubcomponents().flatMap(part =>
            [offset(text(part, 'tzoffsetfrom')), offset(text(part, 'tzoffsetto'))]))].sort((a, b) => a - b);
        if (!this.offsets.length) invalid();
    }
    cover(year: number): void {
        if (this.until >= year) return;
        const transitions: Transition[] = [];
        for (const part of this.component.getAllSubcomponents()) {
            this.budget.check();
            const start = one(part, 'dtstart');
            if (!start) invalid();
            const wall = parseWall(start.toJSON()[3]);
            const before = offset(text(part, 'tzoffsetfrom')), after = offset(text(part, 'tzoffsetto'));
            const add = (value: Wall) => transitions.push({at: nominal(value) - before, before, after});
            add(wall);
            for (const dates of part.getAllProperties('rdate')) {
                for (const raw of dates.toJSON().slice(3)) { this.budget.check(); add(parseWall(raw)); }
            }
            for (const property of part.getAllProperties('rrule')) {
                const rule = property.getFirstValue() as InstanceType<typeof ICAL.Recur>;
                const iterator = rule.iterator(new ICAL.Time(wall, ICAL.Timezone.utcTimezone));
                let iterations = 0;
                for (let value = iterator.next(); value; value = iterator.next()) {
                    this.budget.check();
                    if (value.year > year + 1) break;
                    if (++iterations > 100_000) throw new CalendarFailure('EXPANSION_LIMIT');
                    add(value);
                }
            }
        }
        this.transitions = transitions.sort((a, b) => a.at - b.at);
        this.until = year;
    }
    at(epoch: number): number {
        this.cover(wallAt(epoch).year);
        let lo = 0, hi = this.transitions.length;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (this.transitions[mid]!.at <= epoch) lo = mid + 1;
            else hi = mid;
        }
        return lo ? this.transitions[lo - 1]!.after : this.transitions[0]!.before;
    }
}

/** Each expansion owns its timezone registry; feed definitions never escape it. */
export class Timezones {
    private zones = new Map<string, Zone>();
    private custom = new Map<string, Component>();
    constructor(root: Component, private budget: EngineBudget) {
        for (const component of root.getAllSubcomponents('vtimezone')) {
            const id = text(component, 'tzid');
            if (!id || this.custom.has(id)) invalid();
            this.custom.set(id, component);
        }
    }
    private get(id: string): Zone | null {
        if (id === 'UTC' || id === 'Etc/UTC' || id === 'GMT' || id === 'Etc/GMT') return null;
        if (!this.zones.has(id)) {
            const data = Object.hasOwn(zoneData, id) ? (zoneData as Record<string, string>)[id] : undefined;
            const component = this.custom.get(id) ?? (data ? parseComponent(data, this.budget) : null);
            if (!component) throw new CalendarFailure('UNKNOWN_TIME_ZONE');
            this.zones.set(id, new Zone(component, this.budget));
        }
        return this.zones.get(id)!;
    }
    at(epoch: number, id: string): Instant {
        this.budget.check();
        const seconds = this.get(id)?.at(epoch) ?? 0;
        return {epoch, offset: seconds, zone: id, wall: wallAt(epoch + seconds), gap: false};
    }
    resolve(wall: Wall, id: string): Instant {
        this.budget.check();
        // RecurIterator reuses its Time instance; retain an independent civil value.
        wall = wallAt(nominal(wall), wall.isDate);
        const zone = this.get(id), local = nominal(wall);
        if (!zone) return {epoch: local, wall, zone: id, offset: 0, gap: false};
        zone.cover(wall.year);
        let epoch: number | null = null;
        for (const candidateOffset of zone.offsets) {
            const candidate = local - candidateOffset;
            if (zone.at(candidate) === candidateOffset && (epoch === null || candidate < epoch)) epoch = candidate;
        }
        let gap = false;
        if (epoch === null) {
            gap = true;
            for (const before of zone.offsets) {
                const after = zone.at(local - before);
                if (after > before && zone.at(local - after) === before) { epoch = local - before; break; }
            }
        }
        if (epoch === null) invalid();
        const result = this.at(epoch, id);
        if (wall.isDate) result.wall = wall;
        result.gap = gap;
        return result;
    }
    property(property: Property, contextZone: string, raw = property.toJSON()[3]): Instant {
        const wall = parseWall(raw);
        const id = String(raw).endsWith('Z') ? 'UTC' : String(property.getParameter('tzid') ?? contextZone);
        return this.resolve(wall, id);
    }
}
export function dateText(wall: Wall): string {
    return `${String(wall.year).padStart(4, '0')}-${String(wall.month).padStart(2, '0')}-${String(wall.day).padStart(2, '0')}`;
}
export function instantText(instant: Instant): string {
    if (instant.wall.isDate) return dateText(instant.wall);
    const {wall, offset: seconds} = instant;
    const pad = (n: number) => String(n).padStart(2, '0');
    const magnitude = Math.abs(seconds);
    const suffix = `${seconds < 0 ? '-' : '+'}${pad(Math.floor(magnitude / 3600))}:${pad(Math.floor(magnitude % 3600 / 60))}`;
    // RFC3339 has minute offsets; UTC preserves historical sub-minute instants.
    if (magnitude % 60) return new Date(instant.epoch * 1000).toISOString().replace('.000Z', 'Z');
    return `${dateText(wall)}T${pad(wall.hour)}:${pad(wall.minute)}:${pad(wall.second)}${suffix}`;
}
export function occurrenceKey(instant: Instant): string {
    return instant.wall.isDate ? dateText(instant.wall) : new Date(instant.epoch * 1000).toISOString().replace('.000Z', 'Z');
}
