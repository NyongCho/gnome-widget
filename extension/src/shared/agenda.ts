import type {CalendarEvent} from '../types.js';
/** Calendar expansion supplies a finite view; end is exclusive for both event types. */
export function selectAgenda(events:CalendarEvent[],nowMs:number,today:string):CalendarEvent[]{
    const ongoing=(e:CalendarEvent)=>e.allDay?e.start<=today:Date.parse(e.start)<=nowMs;
    return events.filter(e=>e.allDay?e.end>today:Date.parse(e.end)>nowMs)
        .sort((a,b)=>Number(ongoing(b))-Number(ongoing(a))||
            (a.allDay||b.allDay?a.start.localeCompare(b.start):Date.parse(a.start)-Date.parse(b.start))||
            a.uid.localeCompare(b.uid)||a.occurrenceKey.localeCompare(b.occurrenceKey)).slice(0,3);
}
