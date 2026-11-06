import {calendarSummary as validate} from '../../generated/validators.js';
import type {CalendarContext,ProviderMap,ProviderStatus} from '../types.js';
import {DataFailure} from '../data/errors.js';
import {parseProviderState} from './validation.js';
export interface CalendarSummary {version:1;instanceId:string;revision:number;sourceId:string|null;generation:number;context:CalendarContext|null;status:ProviderStatus;updatedAt:string|null;errorCode:string|null;hasData:boolean;eventCount:number}
export type CalendarOrigin='shell'|'preview'|'rust'|'unavailable';
export function parseCalendarSummary(raw:string):CalendarSummary {
    if(raw.length>16384||new TextEncoder().encode(raw).length>16384)throw new DataFailure('INVALID_DATA');
    let value:unknown;try{value=JSON.parse(raw);}catch{throw new DataFailure('INVALID_DATA');}
    if(!validate(value))throw new DataFailure('INVALID_DATA');const summary=value as CalendarSummary;
    if(!summary.hasData&&summary.eventCount!==0||summary.hasData&&!summary.context)throw new DataFailure('INVALID_DATA');
    // Reuse DTO state invariants without materializing any private events.
    try{parseProviderState('calendar',JSON.stringify({status:summary.status,sourceId:summary.sourceId,updatedAt:summary.updatedAt,errorCode:summary.errorCode,data:summary.hasData?{...summary.context,events:[]}:null}));}
    catch{throw new DataFailure('INVALID_DATA');}
    return summary;
}
export function summarizeCalendar(instanceId:string,revision:number,generation:number,state:ProviderMap['calendar'],context:CalendarContext|null):CalendarSummary {
    return parseCalendarSummary(JSON.stringify({version:1,instanceId,revision,sourceId:state.sourceId,generation,context:state.data?{month:state.data.month,timeZone:state.data.timeZone,weekStart:state.data.weekStart}:context,status:state.status,updatedAt:state.updatedAt,errorCode:state.errorCode,hasData:state.data!==null,eventCount:state.data?.events.length??0}));
}
