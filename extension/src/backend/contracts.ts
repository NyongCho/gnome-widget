import type {ProviderName,CalendarContext} from '../types.js';
import type {ProviderStore} from '../shared/providerStore.js';
import type {ConnectionState} from '../shared/dataClient.js';
export interface WidgetDataSession {
    start(providers:ProviderName[]):void;
    /** Releases card demand; preferences may still need calendar data. */
    stop():void;
    setCalendarContext(context:CalendarContext,day:string):void;
    refreshAfterResume():void;
    /** Disposes the whole session, including preferences demand and status export. */
    destroy():void;
}
export interface WidgetSessionOptions {
    extensionPath:string;store:ProviderStore;
    changed(provider?:ProviderName):void;
    connection(state:ConnectionState):void;
}

export interface PreferencesDataSession {
    getSettings(cancel:import('../shared/dataClient.js').Cancellation):Promise<import('../types.js').Settings>;
    setCalendarSecret(url:string,cancel:import('../shared/dataClient.js').Cancellation):Promise<void>;
    clearCalendarSecret(cancel:import('../shared/dataClient.js').Cancellation):Promise<void>;
    searchLocations(query:string,cancel:import('../shared/dataClient.js').Cancellation):Promise<import('../types.js').WeatherLocation[]>;
    setWeatherLocation(location:import('../types.js').WeatherLocation|null,cancel:import('../shared/dataClient.js').Cancellation):Promise<void>;
    setNetworkInterface(name:string,cancel:import('../shared/dataClient.js').Cancellation):Promise<void>;
    listNetworkInterfaces(cancel:import('../shared/dataClient.js').Cancellation):Promise<string[]>;
    watchCalendar(changed:(state:import('../shared/calendarSummary.js').CalendarSummary,origin:import('../shared/calendarSummary.js').CalendarOrigin)=>void):()=>void;
    refreshCalendar(cancel:import('../shared/dataClient.js').Cancellation):Promise<void>;
    destroy():void;
}
