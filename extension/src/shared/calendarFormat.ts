import type {CalendarEvent} from '../types.js';
export interface CalendarDay{iso:string;day:number;inMonth:boolean}
export function monthGrid(month:string,weekStart:number):CalendarDay[]{
    if(!/^\d{4}-\d{2}$/.test(month)||weekStart<0||weekStart>6)throw new Error('Invalid calendar context');
    const [year,m]=month.split('-').map(Number) as [number,number];
    const first=new Date(Date.UTC(year,m-1,1));
    const offset=(first.getUTCDay()-weekStart+7)%7;
    return Array.from({length:42},(_,index)=>{
        const date=new Date(Date.UTC(year,m-1,index-offset+1));
        return{iso:date.toISOString().slice(0,10),day:date.getUTCDate(),inMonth:date.getUTCMonth()===m-1};
    });
}

export function eventDays(events:CalendarEvent[],days:CalendarDay[],timeZone:string):Set<string>{
    const format=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'});
    const iso=(time:number)=>{const parts=format.formatToParts(time);return ['year','month','day'].map(type=>parts.find(part=>part.type===type)!.value).join('-');};
    const result=new Set<string>();
    for(const event of events){
        const start=event.allDay?event.start:iso(Date.parse(event.start));
        const end=event.allDay?event.end:iso(Math.max(Date.parse(event.start),Date.parse(event.end)-1));
        for(const day of days)if(day.iso>=start&&(event.allDay?day.iso<end:day.iso<=end))result.add(day.iso);
    }
    return result;
}
