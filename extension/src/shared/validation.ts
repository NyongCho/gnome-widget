import type {
    CalendarContext,
    ProviderMap,
    ProviderName,
    Settings,
    WeatherLocation,
} from '../types.js';
import { settings } from '../../generated/validators/settings.js';
import { calendarContext } from '../../generated/validators/calendarContext.js';
import { weatherLocation } from '../../generated/validators/weatherLocation.js';
import { locationSearchResults } from '../../generated/validators/locationSearchResults.js';
import { calendar } from '../../generated/validators/calendar.js';
import { weather } from '../../generated/validators/weather.js';
import { system } from '../../generated/validators/system.js';
import { network } from '../../generated/validators/network.js';
import { media } from '../../generated/validators/media.js';
export const MAX_PAYLOAD_BYTES = 512 * 1024;
export class ValidationError extends Error {
    constructor() {
        super('Invalid protocol payload');
        this.name = 'ValidationError';
    }
}
export function parse<T>(input: string, validate: (data: unknown) => boolean): T {
    if (new TextEncoder().encode(input).length > MAX_PAYLOAD_BYTES) throw new ValidationError();
    let value: unknown;
    try {
        value = JSON.parse(input);
    } catch {
        throw new ValidationError();
    }
    if (!validate(value)) throw new ValidationError();
    return value as T;
}
export function parseSettings(input: string): Settings {
    return parse(input, settings);
}
export function parseCalendarContext(input: string): CalendarContext {
    return parse(input, calendarContext);
}
export function parseWeatherLocation(input: string): WeatherLocation | null {
    return parse(input, weatherLocation);
}
export function parseLocationSearchResults(input: string): WeatherLocation[] {
    return parse(input, locationSearchResults);
}
const providerValidators = {
    calendar: calendar,
    weather: weather,
    system: system,
    network: network,
    media: media,
};
export function parseProviderState<K extends ProviderName>(name: K, input: string): ProviderMap[K] {
    if (!Object.hasOwn(providerValidators, name)) throw new ValidationError();
    return parse(input, providerValidators[name]);
}
