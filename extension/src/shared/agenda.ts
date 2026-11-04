import {translate,type Language} from './i18n.js';
import type {CalendarEvent} from '../types.js';
function localStart(event:CalendarEvent,timeZone:string):string{
    if(event.allDay)return `${event.start}T00:00:00`;
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(Date.parse(event.start));
    const part=(name:string)=>parts.find(p=>p.type===name)!.value;
    return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}`;
}
/** Calendar supplies a month/agenda union; apply the agenda's local-day horizon here. */
export function selectAgenda(events:CalendarEvent[],nowMs:number,today:string,timeZone='UTC'):CalendarEvent[]{
    const limit=new Date(`${today}T00:00:00Z`);limit.setUTCDate(limit.getUTCDate()+30);
    const horizon=limit.toISOString().slice(0,10);
    const ongoing=(e:CalendarEvent)=>e.allDay?e.start<=today:Date.parse(e.start)<=nowMs;
    return events.filter(e=>(e.allDay?e.end>today:Date.parse(e.end)>nowMs)&&(ongoing(e)||localStart(e,timeZone).slice(0,10)<horizon))
        .sort((a,b)=>Number(ongoing(b))-Number(ongoing(a))||
            (a.allDay||b.allDay?localStart(a,timeZone).localeCompare(localStart(b,timeZone)):Date.parse(a.start)-Date.parse(b.start))||
            a.uid.localeCompare(b.uid)||a.occurrenceKey.localeCompare(b.occurrenceKey)).slice(0,3);
}
export function formatAgendaWhen(event:CalendarEvent,timeZone:string,locale:string,hour12:boolean,language:Language='ko'):string{
    const at=event.allDay?Date.parse(`${event.start}T12:00:00Z`):Date.parse(event.start);
    const date=new Intl.DateTimeFormat(locale,{timeZone:event.allDay?'UTC':timeZone,month:'short',day:'numeric',weekday:'short'}).format(at);
    const time=event.allDay?translate(language,'종일'):new Intl.DateTimeFormat(locale,{timeZone,hour:'2-digit',minute:'2-digit',hourCycle:hour12?'h12':'h23'}).format(at);
    return `${date} · ${time}`;
}
