// EXPERIMENT ONLY: measures library behavior; not a production calendar engine.
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import System from 'system';
import ICAL from './node_modules/ical.js/dist/ical.js';

export const here=GLib.path_get_dirname(Gio.File.new_for_uri(import.meta.url).get_path());
const read=path=>new TextDecoder().decode(GLib.file_get_contents(path)[1]);
const now=()=>GLib.get_monotonic_time()/1000;
const sleep=ms=>new Promise(resolve=>GLib.timeout_add(GLib.PRIORITY_DEFAULT,ms,()=>{resolve();return GLib.SOURCE_REMOVE;}));
const yieldLoop=()=>new Promise(resolve=>GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE,()=>{resolve();return GLib.SOURCE_REMOVE;}));
const utc=ICAL.Timezone.utcTimezone;
export let activePhase=null;

function zones() {
    ICAL.TimezoneService.reset();
    for(const name of ['Asia/Seoul','America/New_York','America/Santiago']){
        const component=new ICAL.Component(ICAL.parse(read(`${here}/zones/${name.replaceAll('/','_')}.ics`)));
        ICAL.TimezoneService.register(name,new ICAL.Timezone({component,tzid:name}));
    }
}

// Public parse.property API plus a deliberately small incremental component scanner.
// A single huge property / parser call remains non-preemptible. This is measured below.
export async function incrementalParse(text,{budget=2,cancel=null}={}) {
    const stack=[],roots=[];let pending='',position=0,last=now(),lines=0;
    function line(value){
        if(!value)return;
        if(value.startsWith('BEGIN:')){
            const node=[value.slice(6).toLowerCase(),[],[]];
            if(stack.length)stack.at(-1)[2].push(node);else roots.push(node);
            stack.push(node);
        }else if(value.startsWith('END:')){
            if(stack.at(-1)?.[0]!==value.slice(4).toLowerCase())throw new Error('InvalidComponent');
            stack.pop();
        }else{
            if(!stack.length)throw new Error('InvalidProperty');
            stack.at(-1)[1].push(ICAL.parse.property(value));
        }
    }
    while(position<text.length){
        const end=text.indexOf('\n',position),next=end<0?text.length:end;
        let part=text.slice(position,next);if(part.endsWith('\r'))part=part.slice(0,-1);
        position=next+1;
        if(part.startsWith(' ')||part.startsWith('\t'))pending+=part.slice(1);
        else{line(pending);pending=part;}
        if(++lines%64===0||now()-last>=budget){
            if(now()-last>=budget){await yieldLoop();if(cancel?.cancelled)throw new Error('Cancelled');last=now();}
        }
    }
    line(pending);if(stack.length)throw new Error('InvalidComponent');
    return roots.length===1?roots[0]:roots;
}

function applyZones(component,zone) {
    for(const property of component.getAllProperties()) {
        const tzid=property.getParameter('tzid');
        if(tzid&&!ICAL.TimezoneService.has(tzid))throw new Error('UnknownTimezone');
        for(const value of property.getValues())if(value instanceof ICAL.Time&&!value.isDate&&value.zone===ICAL.Timezone.localTimezone&&!tzid)value.zone=zone;
    }
    for(const child of component.getAllSubcomponents())applyZones(child,zone);
}
function windows(context,instant) {
    const tz=GLib.TimeZone.new_identifier(context.timeZone);
    let first=GLib.DateTime.new(tz,...context.month.split('-').map(Number),1,0,0,0);
    let end=first.add_months(1);
    first=first.add_days(-((first.get_day_of_week()%7-context.weekStart+7)%7));
    end=end.add_days((context.weekStart-end.get_day_of_week()%7+7)%7);
    return [[first.to_unix(),end.to_unix()],[Date.parse(instant)/1000,Date.parse(instant)/1000+30*86400]];
}
function timestamp(time) {return time.isDate?time.toString():time.convertToZone(utc).toString();}
function intersects(start,end,ranges,zone) {
    const a=start.clone(),b=end.clone();if(a.isDate)a.zone=zone;if(b.isDate)b.zone=zone;
    const x=a.toUnixTime(),y=b.toUnixTime();
    return ranges.some(([lo,hi])=>x<hi&&(y>x?y>lo:x>=lo));
}
function rejectUnsupported(component) {
    const seen=new Set();
    for(const event of component.getAllSubcomponents('vevent')) {
        const key=`${event.getFirstPropertyValue('uid')}:${event.getFirstPropertyValue('recurrence-id')??'master'}`;
        if(seen.has(key))throw new Error('UnsupportedCalendar');seen.add(key);
        if(event.hasProperty('exrule')||event.getFirstProperty('recurrence-id')?.getParameter('range')||event.getAllProperties('rdate').some(p=>p.type==='period'))throw new Error('UnsupportedCalendar');
    }
}

export async function expand(input,cooperative=false) {
    zones();
    if(new TextEncoder().encode(input.ics).length>5*1024*1024)throw new Error('InputLimit');
    const raw=cooperative?await incrementalParse(input.ics):ICAL.parse(input.ics);
    const component=new ICAL.Component(raw),zone=ICAL.TimezoneService.get(input.context.timeZone);
    for(const part of component.getAllSubcomponents('vtimezone')){
        const tzid=part.getFirstPropertyValue('tzid');ICAL.TimezoneService.register(tzid,new ICAL.Timezone({component:part,tzid}));
    }
    rejectUnsupported(component);applyZones(component,zone);
    const ranges=windows(input.context,input.now),upper=Math.max(...ranges.map(r=>r[1]));
    const parts=component.getAllSubcomponents('vevent'),events=[],exceptionIndex=new Map();
    for(const part of parts)if(part.hasProperty('recurrence-id')){
        const uid=part.getFirstPropertyValue('uid');
        if(!exceptionIndex.has(uid))exceptionIndex.set(uid,[]);
        exceptionIndex.get(uid).push(part);
    }
    let calls=0,candidates=0,last=now();
    for(const part of parts) {
        if(part.hasProperty('recurrence-id')||part.getFirstPropertyValue('status')==='CANCELLED')continue;
        const uid=part.getFirstPropertyValue('uid');
        const exceptions=exceptionIndex.get(uid)??[];
        const event=new ICAL.Event(part,{exceptions});
        if(!event.startDate)throw new Error('MissingStart');
        const iter=event.isRecurring()?event.iterator():null;
        while(true){
            if(++calls>100000)throw new Error('ExpansionLimit');
            const occurrence=iter?iter.next():event.startDate;if(!occurrence)break;
            if(occurrence.toUnixTime()>=upper)break;
            const details=event.getOccurrenceDetails(occurrence);
            if(intersects(details.startDate,details.endDate,ranges,zone)&&details.item.component.getFirstPropertyValue('status')!=='CANCELLED'){
                if(++candidates>10000)throw new Error('ExpansionLimit');
                events.push({uid,occurrenceKey:timestamp(occurrence),title:details.item.summary??'',start:timestamp(details.startDate),end:timestamp(details.endDate),allDay:details.startDate.isDate});
            }
            if(!iter)break;
            if(cooperative&&(calls%128===0||now()-last>=2)){await yieldLoop();last=now();}
        }
        if(cooperative&&now()-last>=2){await yieldLoop();last=now();}
    }
    return events;
}
function canonical(events){
    return events.map(e=>({uid:e.uid,occurrenceKey:e.occurrenceKey,title:e.title,allDay:e.allDay,start:e.allDay?e.start:new Date(e.start).toISOString(),end:e.allDay?e.end:new Date(e.end).toISOString()})).sort((a,b)=>`${a.start}:${a.uid}:${a.occurrenceKey}`.localeCompare(`${b.start}:${b.uid}:${b.occurrenceKey}`));
}
export async function correctness(){
    const cases=JSON.parse(read(`${here}/results/cases.json`));
    const oracle=new Map(read(`${here}/results/oracle.jsonl`).trim().split('\n').map(line=>{const item=JSON.parse(line);return[item.name,item];}));
    const rows=[];
    for(const test of cases){
        let result;try{result={events:await expand(test,true)};}catch(e){result={error:e.message};}
        const expected=oracle.get(test.name);
        const pass=expected.error?!!result.error:!!result.events&&JSON.stringify(canonical(result.events))===JSON.stringify(canonical(expected.events));
        rows.push({name:test.name,pass,expected:expected.error??canonical(expected.events),actual:result.error??canonical(result.events)});
    }
    return rows;
}

function calendar(count,padding=0){
    const events=[];for(let i=0;i<count;i++)events.push(`BEGIN:VEVENT\r\nUID:synthetic-${i}\r\nDTSTART:20261104T090000Z\r\nDTEND:20261104T100000Z\r\nSUMMARY:Synthetic ${i}\r\nDESCRIPTION:${'x'.repeat(padding)}\r\nEND:VEVENT\r\n`);
    return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events.join('')}END:VCALENDAR\r\n`;
}
export function workloads(){
    return [
        {name:'idle',text:'',kind:'idle'},
        ...[100,1000,10000].map(count=>({name:`${count}-events`,text:calendar(count),kind:'parse'})),
        {name:'near-5MiB-many-events',text:calendar(10000,360),kind:'parse'},
        {name:'near-5MiB-one-property',text:calendar(1,5*1024*1024-512),kind:'parse'},
        ...[1000,10000].map(count=>({name:`${count}-parse-and-expand`,text:calendar(count),kind:'expand'})),
        {name:'historical-100k',text:'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:history\r\nDTSTART:20200101T000000Z\r\nRRULE:FREQ=SECONDLY\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n',kind:'recurrence'},
        {name:'sparse-single-next',text:'FREQ=SECONDLY;BYMONTH=2;BYMONTHDAY=29;BYHOUR=0;BYMINUTE=0;BYSECOND=0;UNTIL=20261231T235959Z',kind:'single-next'},
    ];
}
export async function measure(work,mode,trial){
    System.gc();await sleep(60);
    const gaps=[],frames=[];let last=now();
    const timer=GLib.timeout_add(GLib.PRIORITY_DEFAULT,5,()=>{const current=now();gaps.push(current-last);last=current;return GLib.SOURCE_CONTINUE;});
    activePhase={frames};await sleep(25);
    const started=now();let result=null;
    try {
        if(work.kind==='idle')await sleep(80);
        else if(work.kind==='parse'){
            const raw=mode==='cooperative'?await incrementalParse(work.text):ICAL.parse(work.text);
            result={events:raw[2].filter(c=>c[0]==='vevent').length};
        }else if(work.kind==='single-next'){
            const iterator=ICAL.Recur.fromString(work.text).iterator(ICAL.Time.fromString('2024-02-29T00:00:00Z'));
            iterator.next();
            if(mode==='cooperative')await yieldLoop();
            result={next:iterator.next()?.toString()??null};
        }else if(work.kind==='expand'){
            const events=await expand({ics:work.text,context:{month:'2026-11',timeZone:'Asia/Seoul',weekStart:1},now:'2026-11-03T12:00:00+09:00'},mode==='cooperative');
            result={events:events.length};
        }else{
            const part=new ICAL.Component(ICAL.parse(work.text)).getFirstSubcomponent('vevent');
            const iterator=new ICAL.Event(part).iterator();
            let limit=now();for(let i=0;i<100000;i++){
                iterator.next();
                if(mode==='cooperative'&&(i%128===0||now()-limit>=2)){await yieldLoop();limit=now();}
            }
            result={iterations:100000};
        }
    }catch(error){result={error:error.message};}
    const elapsedMs=now()-started;
    await sleep(35);activePhase=null;GLib.source_remove(timer);
    const sorted=[...gaps].sort((a,b)=>a-b);
    return {name:work.name,mode,trial,bytes:work.text.length,elapsedMs,maxHeartbeatGapMs:Math.max(...gaps),p95HeartbeatGapMs:sorted[Math.ceil(sorted.length*.95)-1],maxFrameGapMs:frames.length?Math.max(...frames):null,frames:frames.length,result};
}
export async function benchmark(repetitions=3,onRow=()=>{}){
    const rows=[];
    for(const work of workloads())for(let trial=0;trial<repetitions;trial++)for(const mode of trial%2?['cooperative','sync']:['sync','cooperative']){
        const row=await measure(work,mode,trial);rows.push(row);onRow(row);
    }
    return rows;
}
export async function smoke(){
    const capabilities={};
    for(const module of ['Soup?version=3.0','Secret?version=1','Gio'])try{await import(`gi://${module}`);capabilities[module]='imported';}catch{capabilities[module]='missing';}
    const started=now();
    await new Promise((resolve,reject)=>Gio.File.new_for_path('/proc/stat').load_contents_async(null,(file,result)=>{try{const [ok,bytes]=file.load_contents_finish(result);if(!ok||!bytes.length)throw new Error('empty');resolve();}catch(e){reject(e);}}));
    capabilities.procAsyncMs=now()-started;return capabilities;
}
