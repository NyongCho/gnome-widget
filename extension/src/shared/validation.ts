import type { CalendarContext, ProviderMap, ProviderName, Settings, Snapshot, WeatherLocation } from '../types.js';
import * as validators from '../../generated/validators.js';
export const MAX_PAYLOAD_BYTES = 512 * 1024;
export class ValidationError extends Error {
    constructor() { super('Invalid protocol payload'); this.name = 'ValidationError'; }
}
function parse<T>(input: string, validate: (data: unknown) => boolean): T {
    if (new TextEncoder().encode(input).length > MAX_PAYLOAD_BYTES) throw new ValidationError();
    let value: unknown;
    try { value = JSON.parse(input); } catch { throw new ValidationError(); }
    if (!validate(value)) throw new ValidationError();
    return value as T;
}
export function parseSnapshot(input: string): Snapshot { return parse(input, validators.snapshot); }
export function parseSettings(input: string): Settings { return parse(input, validators.settings); }
export function parseCalendarContext(input: string): CalendarContext { return parse(input, validators.calendarContext); }
export function parseWeatherLocation(input: string): WeatherLocation | null { return parse(input, validators.weatherLocation); }
export function parseLocationSearchResults(input: string): WeatherLocation[] { return parse(input, validators.locationSearchResults); }
const providerValidators = { calendar: validators.calendar, weather: validators.weather, system: validators.system, network: validators.network, media: validators.media };
export function parseProviderState<K extends ProviderName>(name: K, input: string): ProviderMap[K] {
    if (!Object.hasOwn(providerValidators, name)) throw new ValidationError();
    return parse(input, providerValidators[name]);
}
