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
