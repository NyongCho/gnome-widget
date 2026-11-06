import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';
import {CalendarProvider} from '../../src/data/providers/calendar.js';
import {CalendarWorkerClient} from '../../src/calendar/workerClient.js';
import {DataSettingsService} from '../../src/data/settings.js';
import {CALENDAR_CACHE_FILES} from '../../src/data/config.js';
import {createPublicDataServices,gioClock} from '../../src/data/runtime.js';
import {LocalWidgetSession} from '../../src/data/localSession.js';
import {ProviderStore} from '../../src/shared/providerStore.js';
import {Cancellation} from '../../src/shared/dataClient.js';
import {gioAsync} from '../../src/data/async.js';
import type {SecretStore} from '../../src/data/contracts.js';
import type {ProviderContext} from '../../src/data/scheduler.js';
const [directory,endpoint]=ARGV as [string,string],loop=new GLib.MainLoop(null,false);let exitCode=0;
const URL='https://calendar.google.com/calendar/ical/synthetic/private-fixture/basic.ics',cancel=()=>new Cancellation();
const wait=(ms:number)=>new Promise<void>(resolve=>GLib.timeout_add(0,ms,()=>{resolve();return GLib.SOURCE_REMOVE;}));
function assert(value:unknown,message:string):asserts value{if(!value)throw new Error(message);}
async function until(predicate:()=>Promise<boolean>|boolean,label:string,ms=4000){const end=GLib.get_monotonic_time()+ms*1000;while(!await predicate()){assert(GLib.get_monotonic_time()<end,label);await wait(10);}}
async function leased(){const bus=Gio.DBus.session,reply=await gioAsync(cb=>bus.call('org.freedesktop.DBus','/org/freedesktop/DBus','org.freedesktop.DBus','NameHasOwner',new GLib.Variant('(s)',['io.github.NyongCho.LiquidWidgets.CalendarJob']),new GLib.VariantType('(b)'),0,1000,null,cb),r=>bus.call_finish(r));return(reply.deep_unpack() as [boolean])[0];}
function setup(){
    const services=createPublicDataServices(),values=new Map<string,string>(),secrets:SecretStore={async lookup(source){return values.get(source)??null;},async save(source,url){values.set(source,url);},async remove(source){values.delete(source);},async clearAll(){values.clear();}};
    const settings=new DataSettingsService(services.config,secrets,services.cache,GLib.uuid_string_random),worker=new CalendarWorkerClient(directory);let requests=0,canceled=0,jobs=0;
    const deps={config:services.config,files:services.cache,secrets,http:{async get(_url:string,limits:{maxBytes:number;timeoutMs:number},c:Cancellation){requests++;const unlink=c.onCancel(()=>canceled++);try{return await services.http.get(`${endpoint}/feed`,limits,c);}finally{unlink();}}},worker:{run:((job,c)=>{jobs++;return worker.run(job,c);}) as CalendarWorkerClient['run'],dispose:()=>worker.dispose()},uuid:GLib.uuid_string_random,digest:(bytes:Uint8Array)=>GLib.compute_checksum_for_bytes(GLib.ChecksumType.SHA256,new GLib.Bytes(bytes))!};
    const provider=new CalendarProvider(deps);
    return{services,settings,worker,provider,deps,get requests(){return requests;},get canceled(){return canceled;},get jobs(){return jobs;},async context(month='2026-11'):Promise<ProviderContext>{return{config:await services.config.read(cancel()),calendarContext:{month,timeZone:'UTC',weekStart:0},now:'2026-11-04T12:00:00Z',cancel:cancel()};},async mode(mode:string){await services.http.get(`${endpoint}/mode/${mode}`,{maxBytes:100,timeoutMs:1000},cancel());},async close(){await provider.destroy();services.destroy();}};
}
void(async()=>{
    const f=setup();await f.settings.setCalendarSecret(URL,cancel());await f.mode('normal');const good=await f.provider.collect(await f.context());assert(good.status==='ok'&&good.data?.events.some(e=>e.title==='Synthetic event'),'HTTP and real worker compute');assert(!await leased(),'no idle calendar worker');
    await f.mode('offline');const december=await f.context('2026-12');december.now='2026-11-05T00:00:00Z';december.calendarContext.weekStart=1;december.calendarContext.timeZone='Asia/Seoul';
    const newWorker=new CalendarWorkerClient(directory),newProvider=new CalendarProvider({...f.deps,worker:newWorker});const stale=await newProvider.collect(december);assert(stale.status==='stale'&&stale.updatedAt===good.updatedAt&&stale.data?.month==='2026-12'&&stale.data?.weekStart===1,'offline new month from disk with original timestamp');await newProvider.destroy();
    await f.mode('invalid');const invalid=await f.provider.collect(await f.context());assert(invalid.status==='stale'&&invalid.errorCode==='INVALID_DATA'&&invalid.updatedAt===good.updatedAt,'invalid UTF-8 processed in child, old raw data remains');
    await f.mode('redirect');const redirect=await f.provider.collect(await f.context());assert(redirect.status==='stale','calendar redirect refused');
    await f.settings.clearCalendarSecret(cancel());for(const file of CALENDAR_CACHE_FILES)assert(await f.services.cache.read(file,6*1024*1024,cancel())===null,'clear removes all caches');await f.close();
    // Each operation is observed through the actual config monitor and scheduler.
    for(const phase of ['http','worker'])for(const action of ['clear','disable']){
        const g=setup();await g.settings.setCalendarSecret(URL,cancel());await g.mode(phase==='http'?'slow':'sparse');
        const store=new ProviderStore();let changes=0;
        const session=new LocalWidgetSession({extensionPath:directory,store,changed(){changes++;},connection(){}},{config:g.services.config,clock:gioClock,drivers:{calendar:g.provider},destroy:()=>g.services.destroy()});await session.ready;
        session.setCalendarContext({month:'2026-11',timeZone:'UTC',weekStart:0},'2026-11-04');session.start(['calendar']);
        if(phase==='http')await until(()=>g.requests===1,'HTTP started');else await until(leased,'worker owns compute lease');
        const start=GLib.get_monotonic_time();
        if(action==='clear'){await g.settings.clearCalendarSecret(cancel());await until(()=>store.get('calendar').status==='unconfigured','config monitor clears UI');await until(async()=>phase==='http'?g.canceled===1:!await leased(),'request canceled');}
        else{session.destroy();await session.drained;}
        await until(async()=>!await leased(),'worker reaped');assert((GLib.get_monotonic_time()-start)/1000000<1,'cancel completes inside 1s');
        if(action==='clear'){for(const file of CALENDAR_CACHE_FILES)assert(await g.services.cache.read(file,6*1024*1024,cancel())===null,'no cache resurrection');session.destroy();await session.drained;}
        const stopped=changes;await wait(50);assert(changes===stopped,'no late UI publication');assert(g.requests===1,'no cancellation retry');
    }
    const overlapping=setup();await overlapping.settings.setCalendarSecret(URL,cancel());await overlapping.mode('sparse');const earlier=overlapping.provider.collect(await overlapping.context()).then(()=> 'unexpected success',error=>error instanceof Error?error.message:'unknown');await until(leased,'superseded worker started');await overlapping.mode('normal');const latest=overlapping.provider.collect(await overlapping.context('2026-12'));assert(await earlier==='CANCELLED','worker supersession stays cancellation, never starts cache fallback');assert((await latest).data?.month==='2026-12','latest worker wins');await overlapping.close();
    const preview=setup();await preview.settings.setCalendarSecret(URL,cancel());await preview.mode('normal');const previewWorker=new CalendarWorkerClient(directory),p=new CalendarProvider({...preview.deps,worker:previewWorker,writeCache:false});assert((await p.collect(await preview.context())).status==='ok','preview validates');for(const file of CALENDAR_CACHE_FILES)assert(await preview.services.cache.read(file,6*1024*1024,cancel())===null,'preview never becomes regular writer');await p.destroy();await preview.close();
    print(JSON.stringify({test:'real calendar HTTP/worker/cache/offline/UTF-8/redirect; clear and disable during HTTP and computation; read-only preview',success:true}));
})().then(()=>loop.quit(),error=>{printerr(`${String(error)}\n${error instanceof Error?error.stack:''}`);exitCode=1;loop.quit();});loop.run();System.exit(exitCode);
