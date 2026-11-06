import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import System from 'system';
import {createPublicDataServices} from '../../src/data/runtime.js';
import {LocalWidgetSession} from '../../src/data/localSession.js';
import {ProviderStore} from '../../src/shared/providerStore.js';
import {Cancellation} from '../../src/shared/dataClient.js';
import {DataCancelled} from '../../src/data/errors.js';
import type {ProviderDriver} from '../../src/data/scheduler.js';
const loop=new GLib.MainLoop(null,false);let exitCode=0;
function assert(v:unknown,message:string):asserts v {if(!v)throw new Error(message);}
function wait(ms:number):Promise<void>{return new Promise(resolve=>GLib.timeout_add(0,ms,()=>{resolve();return GLib.SOURCE_REMOVE;}));}
function fds(){const e=Gio.File.new_for_path('/proc/self/fd').enumerate_children('standard::name',Gio.FileQueryInfoFlags.NONE,null);let count=0;while(e.next_file(null))count++;e.close(null);return count;}
void(async()=>{
    let callbacks=0,cancelled=0,started=0;
    const cycle=async()=>{
        const services=createPublicDataServices(),store=new ProviderStore();
        const driver:ProviderDriver<'system'>={collect(context){started++;return new Promise((_resolve,reject)=>context.cancel.onCancel(()=>{cancelled++;reject(new DataCancelled());}));}};
        const session=new LocalWidgetSession({extensionPath:ARGV[0]!,store,changed(){callbacks++;},connection(){}},{config:services.config,clock:services.clock,drivers:{system:driver},destroy:()=>services.destroy()});
        await session.ready;session.start(['system']);await wait(10);session.destroy();await session.drained;const after=callbacks;await wait(10);assert(callbacks===after,'late UI callback');
    };
    await cycle();System.gc();await wait(50);const before=fds();
    for(let i=0;i<20;i++)await cycle();System.gc();await wait(100);
    assert(started===21&&cancelled===21,'all live collections cancelled');assert(fds()<=before+1,'file monitor or IO descriptor leak');
    print(JSON.stringify({test:'twenty real GJS sessions cancel sources, watchers and callbacks',success:true}));
    const services=createPublicDataServices(),store=new ProviderStore();let calendarCount=0;
    await services.config.read(new Cancellation());
    const originalRead=services.config.read.bind(services.config);let reads=0;
    services.config.read=cancel=>{reads++;return originalRead(cancel);};
    const observe=services.config.watch(()=>{});await services.config.read(new Cancellation());await wait(1200);observe();
    print(JSON.stringify({probe:'reads after one read with watcher',reads}));assert(reads<=2,'reading settings must not generate a file-watch feedback loop');
    await services.config.mutate(async tx=>{await tx.replace({...tx.current,calendar:{sourceId:GLib.uuid_string_random(),enabled:true,deletionPending:false}});},new Cancellation());
    const driver:ProviderDriver<'calendar'>={async collect(context){calendarCount++;return{status:'ok',sourceId:context.config.calendar.sourceId,updatedAt:context.now,errorCode:null,data:{...context.calendarContext,events:[]}};}};
    const session=new LocalWidgetSession({extensionPath:ARGV[0]!,store,changed(){},connection(){}},{config:services.config,clock:services.clock,drivers:{calendar:driver},destroy:()=>services.destroy()});
    session.setCalendarContext({month:'2026-11',timeZone:'UTC',weekStart:0},'2026-11-03');await session.ready;session.setCalendarWatchers(1);await wait(20);assert(calendarCount===1,'prefs demand alone collects');
    const old=store.get('calendar').sourceId;
    await services.config.mutate(async tx=>{await tx.replace({...tx.current,calendar:{...tx.current.calendar,sourceId:GLib.uuid_string_random()}});},new Cancellation());
    await wait(1100);assert(store.get('calendar').sourceId!==old&&store.get('calendar').status==='ok','file watch adopts new source');
    session.stop();assert(store.get('calendar').status==='ok','card demand is independent');session.setCalendarWatchers(0);session.destroy();await session.drained;
    print(JSON.stringify({test:'real config watch and preferences-only calendar demand',success:true}));
})().then(()=>loop.quit(),error=>{printerr(`${String(error)}\n${error instanceof Error?error.stack:''}`);exitCode=1;loop.quit();});
loop.run();System.exit(exitCode);
