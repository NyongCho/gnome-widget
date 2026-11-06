import test from 'node:test';
import assert from 'node:assert/strict';
import {LocalWidgetSession,type SessionClock} from '../src/data/localSession.js';
import type {ProviderContext,ProviderDriver} from '../src/data/scheduler.js';
import {defaultConfig,type DataConfig} from '../src/data/config.js';
import {DataFailure} from '../src/data/errors.js';
import {ProviderStore} from '../src/shared/providerStore.js';
import type {ProviderMap,ProviderName} from '../src/types.js';
const flush=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
class Clock implements SessionClock {
    time=0;next=1;timers=new Map<number,{at:number;fn:()=>void}>();
    monotonic(){return this.time;}now(){return new Date(Date.UTC(2026,10,3,3)+this.time).toISOString();}
    schedule(ms:number,fn:()=>void){const id=this.next++;this.timers.set(id,{at:this.time+ms,fn});return()=>{this.timers.delete(id);};}
    async advance(ms:number){const end=this.time+ms;for(;;){const next=[...this.timers].filter(([,x])=>x.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;this.time=next[1].at;this.timers.delete(next[0]);next[1].fn();await flush();}this.time=end;await flush();}
}
class Driver<K extends ProviderName> implements ProviderDriver<K>{
    calls:{context:ProviderContext;resolve:(state:ProviderMap[K])=>void;reject:(e:Error)=>void}[]=[];resets=0;destroyed=0;
    collect(context:ProviderContext):Promise<ProviderMap[K]>{return new Promise((resolve,reject)=>this.calls.push({context,resolve,reject}));}
    reset(){this.resets++;}destroy(){this.destroyed++;}
}
function fixture(){
    const clock=new Clock(),store=new ProviderStore(),calendar=new Driver<'calendar'>(),weather=new Driver<'weather'>(),system=new Driver<'system'>(),network=new Driver<'network'>();
    let config:DataConfig={...defaultConfig(),calendar:{enabled:true,sourceId:'source-a',deletionPending:false},weather:{sourceId:'city-a',location:{id:'a',label:'A',latitude:1,longitude:2,timeZone:'UTC'}}};
    let watcher:(c:DataConfig)=>void=()=>{};let unwatch=0,cleanups=0;const changes:string[]=[];
    const session=new LocalWidgetSession({extensionPath:'/test',store,changed:name=>changes.push(name??'all'),connection(){}},{clock,config:{async read(){return config;},watch(fn){watcher=fn;return()=>{unwatch++;};}},drivers:{calendar,weather,system,network},destroy(){cleanups++;}});
    session.setCalendarContext({month:'2026-11',timeZone:'Asia/Seoul',weekStart:1},'2026-11-03');
    return{clock,store,calendar,weather,system,network,session,changes,get unwatch(){return unwatch;},get cleanups(){return cleanups;},change(source:string){config={...config,calendar:{...config.calendar,sourceId:source},weather:{...config.weather,sourceId:source}};watcher(config);}};
}
function calendarResult(call:Driver<'calendar'>['calls'][number]):ProviderMap['calendar']{return{status:'ok',sourceId:call.context.config.calendar.sourceId,updatedAt:call.context.now,errorCode:null,data:{...call.context.calendarContext,events:[]}};}
function weatherResult(call:Driver<'weather'>['calls'][number]):ProviderMap['weather']{return{status:'ok',sourceId:call.context.config.weather.sourceId,updatedAt:call.context.now,errorCode:null,data:{location:'A',timeZone:'UTC',current:{temperatureC:0,code:0},hourly:[],attributionUrl:'https://open-meteo.com/'}};}
test('late_reply_ignored and source_change_clears_old_data without overlapping collection',async()=>{
    const f=fixture();await f.session.ready;f.session.start(['calendar']);await flush();const first=f.calendar.calls[0]!;
    first.resolve(calendarResult(first));await flush();assert.ok(f.store.get('calendar').data);
    f.session.refresh('calendar');await flush();const old=f.calendar.calls[1]!;f.change('source-b');
    assert.equal(old.context.cancel.cancelled,true);assert.equal(f.store.get('calendar').data,null);assert.equal(f.calendar.calls.length,2);
    old.resolve(calendarResult(old));await flush();assert.equal(f.calendar.calls.length,3);assert.equal(f.store.get('calendar').sourceId,'source-b');
    const latest=f.calendar.calls[2]!;latest.resolve(calendarResult(latest));await flush();assert.equal(f.store.get('calendar').status,'ok');f.session.destroy();
});
test('last_good_same_source_only preserves original successful timestamp',async()=>{
    const f=fixture();await f.session.ready;f.session.start(['weather']);await flush();const first=f.weather.calls[0]!;first.resolve(weatherResult(first));await flush();
    f.session.refresh('weather');await flush();f.weather.calls[1]!.reject(new DataFailure('NETWORK_ERROR'));await flush();
    assert.equal(f.store.get('weather').status,'stale');assert.equal(f.store.get('weather').updatedAt,first.context.now);
    f.change('city-b');await flush();f.weather.calls[2]!.reject(new DataFailure('NETWORK_ERROR'));await flush();
    assert.equal(f.store.get('weather').status,'unavailable');assert.equal(f.store.get('weather').data,null);f.session.destroy();
});
test('stop_cards_keeps_prefs_calendar and last watcher stops its timer and request',async()=>{
    const f=fixture();await f.session.ready;f.session.start(['calendar']);f.session.setCalendarWatchers(1);await flush();
    f.calendar.calls[0]!.resolve(calendarResult(f.calendar.calls[0]!));await flush();f.session.stop();await f.clock.advance(300000);
    assert.equal(f.calendar.calls.length,2);f.session.setCalendarWatchers(0);assert.ok(f.calendar.calls[1]!.context.cancel.cancelled);assert.equal(f.clock.timers.size,0);f.session.destroy();
});
test('destroy_cancels_everything and late callbacks cannot access the UI',async()=>{
    const f=fixture();await f.session.ready;f.session.start(['calendar','weather']);await flush();f.session.destroy();f.session.destroy();
    const before=f.changes.length;assert.equal(f.unwatch,1);assert.equal(f.cleanups,1);assert.equal(f.clock.timers.size,0);
    assert.ok(f.calendar.calls[0]!.context.cancel.cancelled);f.calendar.calls[0]!.resolve(calendarResult(f.calendar.calls[0]!));f.weather.calls[0]!.resolve(weatherResult(f.weather.calls[0]!));await flush();
    assert.equal(f.changes.length,before);f.session.start(['system']);await flush();assert.equal(f.system.calls.length,0);
});
test('resume_resets_samples and cancels old context before collecting again',async()=>{
    const f=fixture();await f.session.ready;f.session.start(['system','calendar']);await flush();const old=f.calendar.calls[0]!;
    f.session.refreshAfterResume();assert.equal(f.system.resets,1);assert.ok(old.context.cancel.cancelled);old.resolve(calendarResult(old));await flush();assert.equal(f.calendar.calls.length,2);
    f.session.setCalendarContext({month:'2026-12',timeZone:'Asia/Seoul',weekStart:0},'2026-12-01');const previous=f.calendar.calls[1]!;assert.ok(previous.context.cancel.cancelled);previous.resolve(calendarResult(previous));await flush();
    assert.equal(f.calendar.calls[2]!.context.calendarContext.month,'2026-12');f.session.destroy();
});
test('manual refresh rate and periodic timers are independent and bounded',async()=>{
    const f=fixture();await f.session.ready;f.session.start(['weather']);await flush();f.weather.calls[0]!.resolve(weatherResult(f.weather.calls[0]!));await flush();
    f.session.refresh('weather');await flush();f.weather.calls[1]!.resolve(weatherResult(f.weather.calls[1]!));await flush();
    f.session.refresh('weather');await flush();assert.equal(f.weather.calls.length,2);await f.clock.advance(60000);f.session.refresh('weather');await flush();assert.equal(f.weather.calls.length,3);
    f.weather.calls[2]!.resolve(weatherResult(f.weather.calls[2]!));await flush();await f.clock.advance(899999);assert.equal(f.weather.calls.length,3);await f.clock.advance(1);assert.equal(f.weather.calls.length,4);f.session.destroy();
});
test('malformed provider state stays isolated from other providers',async()=>{
    const f=fixture();await f.session.ready;f.session.start(['calendar','weather']);await flush();
    f.calendar.calls[0]!.resolve({...calendarResult(f.calendar.calls[0]!),sourceId:'wrong'});f.weather.calls[0]!.resolve(weatherResult(f.weather.calls[0]!));await flush();
    assert.equal(f.store.get('calendar').status,'unavailable');assert.equal(f.store.get('calendar').errorCode,'INVALID_DATA');assert.equal(f.store.get('weather').status,'ok');f.session.destroy();
});

test('initial config snapshot cannot overwrite a newer file-watch update',async()=>{
    let reads=0,watch:(config:DataConfig)=>void=()=>{},finish!:(config:DataConfig)=>void;
    const old={...defaultConfig(),calendar:{sourceId:'old',enabled:true,deletionPending:false}},newer={...old,calendar:{...old.calendar,sourceId:'new'}};
    const clock=new Clock(),store=new ProviderStore(),driver=new Driver<'calendar'>();
    const session=new LocalWidgetSession({extensionPath:'/test',store,changed(){},connection(){}},{clock,drivers:{calendar:driver},config:{read(){reads++;return reads===1?Promise.resolve(old):new Promise(resolve=>{finish=resolve;});},watch(fn){watch=fn;return()=>{};}}});
    session.start(['calendar']);await flush();watch(newer);finish(old);await session.ready;await flush();
    assert.equal(store.get('calendar').sourceId,'new');session.destroy();
});

test('hiding sampled cards resets their baseline before the next subscription',async()=>{
    const f=fixture();await f.session.ready;f.session.start(['system']);await flush();assert.equal(f.system.resets,0);
    f.session.stop();assert.equal(f.system.resets,1);f.session.start(['system']);f.session.destroy();
});

test('periodic system sampling retains the last complete presentation until its replacement arrives',async()=>{
    const f=fixture();await f.session.ready;f.session.start(['system']);await flush();
    const first=f.system.calls[0]!;
    first.resolve({status:'ok',sourceId:'system',updatedAt:first.context.now,errorCode:null,data:{cpuPercent:25,memoryUsedBytes:1024,memoryTotalBytes:4096,temperatureC:40}});
    await flush();const state=f.store.get('system'),changes=f.changes.length;
    await f.clock.advance(2000);
    assert.equal(f.system.calls.length,2,'periodic collection still runs');
    assert.equal(f.store.get('system'),state,'polling must not flash a loading footer and resize the card');
    assert.equal(f.changes.length,changes,'UI is published when the new sample arrives');
    f.system.calls[1]!.reject(new DataFailure('SERVICE_UNAVAILABLE'));await flush();
    assert.equal(f.store.get('system').status,'stale','failures still reach the UI');
    f.session.destroy();
});


test('periodic network sampling retains the last complete graph until the next sample',async()=>{
    const f=fixture();await f.session.ready;f.session.start(['network']);await flush();
    const first=f.network.calls[0]!;
    first.resolve({status:'ok',sourceId:'network-6175746f',updatedAt:first.context.now,errorCode:null,data:{interface:'eth0',rxBytesPerSec:1,txBytesPerSec:2,history:[]}});
    await flush();const state=f.store.get('network'),changes=f.changes.length;
    await f.clock.advance(2000);assert.equal(f.network.calls.length,2);
    assert.equal(f.store.get('network'),state,'network poll must not resize the graph card');
    assert.equal(f.changes.length,changes);f.session.destroy();
});

test('initial read and monitor failures recover with bounded backoff and destroy cancels recovery',async()=>{
    for(const failure of ['read','watch'] as const){
        const clock=new Clock(),store=new ProviderStore(),calls:(string|null)[]=[];
        const driver:ProviderDriver<'calendar'>={async collect(c){calls.push(c.config.calendar.sourceId);return c.config.calendar.enabled?
            {status:'ok',sourceId:c.config.calendar.sourceId,updatedAt:c.now,errorCode:null,data:{...c.calendarContext,events:[]}}:
            {status:'unconfigured',sourceId:null,updatedAt:null,errorCode:null,data:null};}};
        const config={...defaultConfig(),calendar:{enabled:true,sourceId:'recovered',deletionPending:false}};
        let broken=true,reads=0,watches=0,activeWatches=0;
        const session=new LocalWidgetSession({extensionPath:'/test',store,changed(){},connection(){}},{clock,drivers:{calendar:driver},config:{
            async read(){reads++;if(broken&&failure==='read')throw new DataFailure('SERVICE_UNAVAILABLE');return config;},
            watch(){watches++;if(broken&&failure==='watch')throw new DataFailure('SERVICE_UNAVAILABLE');activeWatches++;return()=>{activeWatches--;};},
        }});
        session.setCalendarWatchers(1);await session.ready;await flush();
        const initial=reads;await clock.advance(999);assert.equal(reads,initial,'no busy retry loop');
        await clock.advance(1);assert.ok(reads>initial,`${failure} failure must retry initialization`);
        broken=false;await clock.advance(2000);
        assert.equal(store.get('calendar').sourceId,'recovered');assert.equal(activeWatches,1);assert.ok(watches>=1);
        assert.equal(calls.filter(source=>source==='recovered').length,1);
        session.destroy();assert.equal(activeWatches,0);assert.equal(clock.timers.size,0);
    }
    const clock=new Clock();let reads=0;
    const session=new LocalWidgetSession({extensionPath:'/test',store:new ProviderStore(),changed(){},connection(){}},{clock,drivers:{},config:{
        async read(){reads++;throw new DataFailure('SERVICE_UNAVAILABLE');},watch(){throw new Error('unreachable');},
    }});
    await session.ready;await clock.advance(120000);assert.ok(reads<=10,'retry interval caps at a quiet cadence');
    session.destroy();const before=reads;await clock.advance(120000);assert.equal(reads,before);assert.equal(clock.timers.size,0);
});

test('deletion-pending changes notify preferences without restarting the calendar collector',async()=>{
    const clock=new Clock(),store=new ProviderStore();let watch!:(config:DataConfig)=>void,notifications=0,collections=0;
    const config={...defaultConfig(),calendar:{enabled:true,sourceId:'same-source',deletionPending:false}};
    const session=new LocalWidgetSession({extensionPath:'/test',store,changed(name){if(name==='calendar')notifications++;},connection(){}},{clock,config:{async read(){return config;},watch(fn){watch=fn;return()=>{};}},drivers:{calendar:{async collect(c){collections++;return{status:'ok',sourceId:c.config.calendar.sourceId,updatedAt:c.now,errorCode:null,data:{...c.calendarContext,events:[]}};}}}});
    await session.ready;session.setCalendarWatchers(1);await flush();
    const collected=collections,before=notifications;
    watch({...config,calendar:{...config.calendar,deletionPending:true}});await flush();
    assert.ok(notifications>before,'a cleanup failure must reach other open settings windows');
    const pending=notifications;watch(config);await flush();
    assert.ok(notifications>pending,'successful cleanup must clear other windows warnings');
    assert.equal(collections,collected,'settings-only changes must not restart computation');session.destroy();
});
