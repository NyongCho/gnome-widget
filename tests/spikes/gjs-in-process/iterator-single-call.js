import GLib from 'gi://GLib';
import ICAL from './node_modules/ical.js/dist/ical.js';
const start=GLib.get_monotonic_time();
const rule=ICAL.Recur.fromString(ARGV[0]);
const dtstart=ARGV[0].includes('BYMONTHDAY=29')?'2024-02-29T00:00:00Z':'2026-01-01T00:00:00Z';
const iterator=rule.iterator(ICAL.Time.fromString(dtstart));
const constructed=GLib.get_monotonic_time();
const calls=[];
for(let i=0;i<5;i++){
    const before=GLib.get_monotonic_time(),value=iterator.next();
    calls.push({ms:(GLib.get_monotonic_time()-before)/1000,value:value?.toString()??null});
    print(JSON.stringify({rule:ARGV[0],dtstart,constructorMs:(constructed-start)/1000,calls}));
    if(!value)break;
}
