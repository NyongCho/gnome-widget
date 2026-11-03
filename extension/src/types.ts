export type ProviderName = 'calendar' | 'weather' | 'system' | 'network' | 'media';
export type ProviderStatus = 'loading' | 'ok' | 'stale' | 'unconfigured' | 'unavailable';
export interface ProviderState<T> { status: ProviderStatus; sourceId: string | null; updatedAt: string | null; data: T | null; errorCode: string | null }
export interface CalendarContext { month: string; timeZone: string; weekStart: number }
export interface CalendarEvent { uid: string; occurrenceKey: string; title: string; start: string; end: string; allDay: boolean }
export interface CalendarData extends CalendarContext { events: CalendarEvent[] }
export interface WeatherLocation { id: string; label: string; latitude: number; longitude: number; timeZone: string }
export interface WeatherData { location: string; timeZone: string; current: { temperatureC: number | null; code: number | null }; hourly: { at: string; temperatureC: number | null; precipitationProbability: number | null }[]; attributionUrl: string }
export interface SystemData { cpuPercent: number | null; memoryUsedBytes: number; memoryTotalBytes: number; temperatureC: number | null }
export interface NetworkData { interface: string; rxBytesPerSec: number | null; txBytesPerSec: number | null; history: { at: string; rx: number; tx: number }[] }
export interface MediaData { player: string; status: 'playing' | 'paused' | 'stopped'; title: string; artist: string; artUri: string | null }
export interface ProviderMap { calendar: ProviderState<CalendarData>; weather: ProviderState<WeatherData>; system: ProviderState<SystemData>; network: ProviderState<NetworkData>; media: ProviderState<MediaData> }
export interface Snapshot extends ProviderMap { schemaVersion: 1; generatedAt: string; revisions: Record<ProviderName, number> }
export interface Settings { calendarEnabled: boolean; calendarSecretDeletionPending: boolean; weatherLocation: WeatherLocation | null; networkInterface: string }
