import GLib from 'gi://GLib';
import System from 'system';
import {selectAgenda} from '../../src/shared/agenda.js';
import {eventDays,monthGrid} from '../../src/shared/calendarFormat.js';
const events=Array.from({length:1000},(_,i)=>({uid:`e${i}`,occurrenceKey:`e${i}`,title:`Event ${i}`,start:'2026-11-10T09:00:00Z',end:'2026-11-10T10:00:00Z',allDay:false}));
const samples=[];
for(let i=0;i<5;i++){
    const start=GLib.get_monotonic_time();
    const agenda=selectAgenda(events,Date.parse('2026-11-07T00:00:00Z'),'2026-11-07','UTC');
    const middle=GLib.get_monotonic_time();const dots=eventDays(events,monthGrid('2026-11',1),'UTC');
    if(agenda.length!==3||dots.size!==1||!dots.has('2026-11-10'))throw new Error('presentation output changed');
    samples.push({agendaMs:(middle-start)/1000,dotsMs:(GLib.get_monotonic_time()-middle)/1000,totalMs:(GLib.get_monotonic_time()-start)/1000});
}
const median=[...samples].sort((a,b)=>a.totalMs-b.totalMs)[2]!.totalMs;
print(JSON.stringify({test:'1000-event calendar and agenda presentation within 20ms median',samples,median,success:median<20}));
System.exit(median<20?0:1);
