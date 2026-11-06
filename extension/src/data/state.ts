import type {CalendarContext,ProviderMap,ProviderName} from '../types.js';
import {parseProviderState} from '../shared/validation.js';
import type {DataConfig} from './config.js';
import {DataFailure,type DataErrorCode} from './errors.js';
export function providerSource(name:ProviderName,config:DataConfig):string|null {
    if(name==='calendar')return config.calendar.enabled?config.calendar.sourceId:null;
    if(name==='weather')return config.weather.location?config.weather.sourceId:null;
    if(name==='network')return `network:${config.networkInterface}`;
    return name==='media'?'mpris':'system';
}
export function sameContext(name:ProviderName,state:ProviderMap[ProviderName],context:CalendarContext):boolean {
    if(name!=='calendar'||!state.data)return true;
    const data=(state as ProviderMap['calendar']).data!;
    return data.month===context.month&&data.timeZone===context.timeZone&&data.weekStart===context.weekStart;
}
export function loadingState<K extends ProviderName>(name:K,source:string|null,previous:ProviderMap[K],context:CalendarContext):ProviderMap[K] {
    if(source===null)return{status:'unconfigured',sourceId:null,data:null,updatedAt:null,errorCode:null} as ProviderMap[K];
    const keep=previous.sourceId===source&&sameContext(name,previous,context);
    return{status:'loading',sourceId:source,data:keep?previous.data:null,updatedAt:keep?previous.updatedAt:null,errorCode:null} as ProviderMap[K];
}
export function failedState<K extends ProviderName>(name:K,source:string|null,previous:ProviderMap[K],context:CalendarContext,error:unknown):ProviderMap[K] {
    const code:DataErrorCode=error instanceof DataFailure?error.code:'SERVICE_UNAVAILABLE';
    const keep=source!==null&&previous.sourceId===source&&previous.data!==null&&sameContext(name,previous,context);
    return{status:keep?'stale':'unavailable',sourceId:source,data:keep?previous.data:null,updatedAt:keep?previous.updatedAt:null,errorCode:code} as ProviderMap[K];
}
export function checkedState<K extends ProviderName>(name:K,state:ProviderMap[K],source:string|null,context:CalendarContext):ProviderMap[K] {
    try{const checked=parseProviderState(name,JSON.stringify(state));
        if(checked.sourceId!==source||!sameContext(name,checked,context))throw new Error('context');return checked;
    }catch{throw new DataFailure('INVALID_DATA');}
}
