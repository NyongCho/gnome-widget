import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {CalendarProvider,type CalendarComputer} from '../src/data/providers/calendar.js';
import {ConfigStore,CALENDAR_CACHE_FILES} from '../src/data/config.js';
import {DataSettingsService} from '../src/data/settings.js';
import {DataFailure} from '../src/data/errors.js';
import {Cancellation} from '../src/shared/dataClient.js';
import {LocalWidgetSession} from '../src/data/localSession.js';
import {ProviderStore} from '../src/shared/providerStore.js';
import type {CalendarData,CalendarContext} from '../src/types.js';
import type {HttpClient,PrivateFiles,SecretStore} from '../src/data/contracts.js';
import type {CalendarJob} from '../src/calendar/protocol.js';
import type {ProviderContext} from '../src/data/scheduler.js';
const URL='https://calendar.google.com/calendar/ical/test/private-synthetic/basic.ics';
const ICS=new TextEncoder().encode('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n');
const cancel=()=>new Cancellation(),flush=async()=>{for(let i=0;i<80;i++)await Promise.resolve();};
const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
function fixture(){
    const map=new Map<string,Uint8Array>(),secretMap=new Map<string,string>(),requests:{url:string;limits:{maxBytes:number;timeoutMs:number}}[]=[],jobs:CalendarJob[]=[];
    const files:PrivateFiles={async read(n,max){const b=map.get(n)??null;if(b&&b.length>max)throw new DataFailure('PAYLOAD_TOO_LARGE');return b;},async replace(n,v){map.set(n,v.slice());},async remove(n){map.delete(n);}};
    let release:()=>void=()=>{},previous=Promise.resolve(),watch:(()=>void)|null=null;
    const config=new ConfigStore({files,uuid:randomUUID,watch(fn){watch=fn;return()=>{watch=null;};},async acquire(){const before=previous;previous=new Promise(r=>{release=r;});const done=release;await before;return{release:done};}});
    const secrets:SecretStore={async lookup(id){return secretMap.get(id)??null;},async save(id,url){secretMap.set(id,url);},async remove(id){secretMap.delete(id);},async clearAll(){secretMap.clear();}};
    const settings=new DataSettingsService(config,secrets,files,randomUUID);let response:()=>Promise<Uint8Array>=async()=>ICS,compute:(job:CalendarJob,c:Cancellation)=>Promise<CalendarData>=async j=>({...j.header.context,events:[]});
    const http:HttpClient={async get(url,limits){requests.push({url,limits});return response();}},worker:CalendarComputer={async run(job,c){jobs.push(job);return compute(job,c);},async dispose(){}};
    const deps={http,secrets,files,config,worker,uuid:randomUUID,digest},provider=new CalendarProvider(deps);
    return{map,files,secretMap,settings,config,provider,deps,jobs,requests,notify(){watch?.();},set response(fn:typeof response){response=fn;},set compute(fn:typeof compute){compute=fn;},async connect(){await settings.setCalendarSecret(URL,cancel());},async context(month='2026-11'):Promise<ProviderContext>{return{config:await config.read(cancel()),calendarContext:{month,timeZone:'UTC',weekStart:0},now:'2026-11-04T12:00:00Z',cancel:cancel()};}};
}
test('fresh calendar sends raw bytes and bounded Google HTTPS request to a versioned worker job',async()=>{
    const f=fixture();await f.connect();const c=await f.context(),state=await f.provider.collect(c);assert.equal(state.status,'ok');assert.deepEqual(f.requests,[{url:URL,limits:{maxBytes:5*1024*1024,timeoutMs:15000}}]);
    assert.equal(f.jobs[0]?.ics,ICS);assert.equal(f.jobs[0]?.header.sourceId,c.config.calendar.sourceId);assert.equal(f.jobs[0]?.header.version,1);assert.deepEqual(f.jobs[0]?.header.context,c.calendarContext);assert.ok(f.jobs[0]?.header.jobId);assert.equal(state.updatedAt,c.now);
    for(const name of CALENDAR_CACHE_FILES)assert.ok(f.map.has(name));assert.ok(!new TextDecoder().decode(f.map.get('calendar-raw.json')).includes(URL));
});
test('switch_source_during_fetch and clear_then_late_cache_write never restore old data',async()=>{
    for(const action of ['switch','clear']){const f=fixture();await f.connect();let finish!:(bytes:Uint8Array)=>void;f.response=()=>new Promise(r=>{finish=r;});const old=f.provider.collect(await f.context());await flush();
        if(action==='switch')await f.settings.setCalendarSecret(URL.replace('synthetic','new'),cancel());else await f.settings.clearCalendarSecret(cancel());finish(ICS);await assert.rejects(old,/CANCELLED/);for(const name of CALENDAR_CACHE_FILES)assert.equal(f.map.has(name),false);assert.equal(f.jobs.length,0);}
});
test('switch_month_during_worker and disable discard late computed data and cache writes',async()=>{
    const f=fixture();await f.connect();let finish!:(data:CalendarData)=>void;f.compute=()=>new Promise(r=>{finish=r;});const c=await f.context(),old=f.provider.collect(c);await flush();c.cancel.cancel();finish({...c.calendarContext,events:[]});await assert.rejects(old,/CANCELLED/);assert.equal(f.map.has('calendar-raw.ics'),false);
    f.compute=async job=>({...job.header.context,events:[]});const next=await f.provider.collect(await f.context('2026-12'));assert.equal(next.data?.month,'2026-12');assert.ok(f.jobs[1]!.header.generation>f.jobs[0]!.header.generation);
});
test('offline_recompute uses raw cache for a new month, timezone, day and week start with original updatedAt',async()=>{
    const f=fixture();await f.connect();const good=await f.provider.collect(await f.context());f.response=async()=>{throw new DataFailure('NETWORK_ERROR');};
    const c=await f.context('2026-12');c.calendarContext.timeZone='Asia/Seoul';c.calendarContext.weekStart=1;c.now='2026-11-05T00:00:00Z';
    const stale=await new CalendarProvider(f.deps).collect(c);assert.equal(stale.status,'stale');assert.equal(stale.errorCode,'NETWORK_ERROR');assert.equal(stale.updatedAt,good.updatedAt);assert.deepEqual(stale.data,{...c.calendarContext,events:[]});assert.equal(f.jobs.at(-1)?.header.now,c.now);
});
test('worker_timeout_keeps_stale for the same context, never a different context',async()=>{
    const f=fixture();await f.connect();const good=await f.provider.collect(await f.context());f.compute=async()=>{throw new DataFailure('EXPANSION_LIMIT');};
    const stale=await f.provider.collect(await f.context());assert.equal(stale.status,'stale');assert.equal(stale.errorCode,'EXPANSION_LIMIT');assert.equal(stale.updatedAt,good.updatedAt);
    await assert.rejects(f.provider.collect(await f.context('2026-12')),/EXPANSION_LIMIT/);
});
test('cache pair digest prevents mixed or truncated atomic writes from becoming offline data',async()=>{
    const f=fixture();await f.connect();await f.provider.collect(await f.context());f.map.set('calendar-raw.ics',new TextEncoder().encode('wrong'));f.response=async()=>{throw new DataFailure('NETWORK_ERROR');};
    await assert.rejects(new CalendarProvider(f.deps).collect(await f.context('2026-12')),/NETWORK_ERROR/);assert.equal(f.jobs.length,1);
});
test('invalid URL and worker context are rejected; preview never writes regular caches',async()=>{
    const f=fixture();await f.connect();const c=await f.context();f.secretMap.set(c.config.calendar.sourceId!,'https://evil.test/basic.ics');await assert.rejects(f.provider.collect(c),/AUTH_ERROR/);assert.equal(f.requests.length,0);
    f.secretMap.set(c.config.calendar.sourceId!,URL);f.compute=async()=>({month:'2020-01',timeZone:'UTC',weekStart:0,events:[]});await assert.rejects(f.provider.collect(c),/INVALID_DATA/);
    f.compute=async j=>({...j.header.context,events:[]});assert.equal((await new CalendarProvider({...f.deps,writeCache:false}).collect(c)).status,'ok');for(const name of CALENDAR_CACHE_FILES)assert.equal(f.map.has(name),false);
});
test('same_source_same_day_coalesces, midnight/week-start/resume each refresh exactly once',async()=>{
    const f=fixture();await f.connect();const context:CalendarContext={month:'2026-11',timeZone:'UTC',weekStart:0};const session=new LocalWidgetSession({extensionPath:'/test',store:new ProviderStore(),changed(){},connection(){}},{config:f.config,drivers:{calendar:f.provider},clock:{monotonic:()=>0,now:()=>new Date().toISOString(),schedule(){return()=>{};}}});await session.ready;
    session.setCalendarContext(context,'2026-11-04');session.start(['calendar']);await flush();assert.equal(f.requests.length,1);
    for(let i=0;i<20;i++)session.setCalendarContext({...context},'2026-11-04');await flush();assert.equal(f.requests.length,1);
    session.setCalendarContext(context,'2026-11-05');await flush();assert.equal(f.requests.length,2);session.setCalendarContext({...context,weekStart:1},'2026-11-05');await flush();assert.equal(f.requests.length,3);session.refreshAfterResume();await flush();assert.equal(f.requests.length,4);session.destroy();await session.drained;
});
test('source is checked again inside the mutation lock and a failed clear reports failure',async()=>{
    const f=fixture();await f.connect();const c=await f.context();let finish!:(data:CalendarData)=>void;f.compute=()=>new Promise(r=>{finish=r;});const old=f.provider.collect(c);await flush();await f.settings.clearCalendarSecret(cancel());finish({...c.calendarContext,events:[]});await assert.rejects(old,/CANCELLED/);for(const n of CALENDAR_CACHE_FILES)assert.equal(f.map.has(n),false);
    await f.connect();f.files.remove=async()=>{throw new DataFailure('SERVICE_UNAVAILABLE');};await assert.rejects(f.settings.clearCalendarSecret(cancel()),/SECRET_DELETION_FAILED/);const settings=await f.settings.getSettings(cancel());assert.equal(settings.calendarEnabled,false);assert.equal(settings.calendarSecretDeletionPending,true);
});
