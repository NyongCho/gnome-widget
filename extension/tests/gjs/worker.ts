import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import System from 'system';
import {Cancellation} from '../../src/shared/dataClient.js';
import {CalendarWorkerClient} from '../../src/calendar/workerClient.js';
import {acquireBusLease, LeaseBusyError, LeaseTimeoutError} from '../../src/data/busLease.js';
import {ProtocolFailure, type CalendarJob} from '../../src/calendar/protocol.js';

const directory=ARGV[0]!;
function assert(ok:unknown,reason:string):asserts ok {if(!ok)throw new Error(reason);}
function delay(ms:number):Promise<void>{return new Promise(resolve=>GLib.timeout_add(GLib.PRIORITY_DEFAULT,ms,()=>{resolve();return GLib.SOURCE_REMOVE;}));}
const makeJob=(id='job'):CalendarJob=>({header:{version:1,jobId:id,sourceId:'synthetic',generation:1,
    context:{month:'2026-11',timeZone:'Asia/Seoul',weekStart:1},now:'2026-11-03T03:00:00Z'},
    ics:new TextEncoder().encode('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:sample\r\nDTSTART:20261104T030000Z\r\nSUMMARY:Sample\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n')});
async function rejects(p:Promise<unknown>,code:string):Promise<void>{
    try{await p;throw new Error('accepted invalid job');}catch(e){assert(e instanceof ProtocolFailure && e.code===code,`expected ${code}, got ${String(e)}`);}
}
async function test(name:string,run:()=>Promise<void>):Promise<void>{await run();print(JSON.stringify({test:name,success:true}));}
const loop=new GLib.MainLoop(null,false);let exitCode=0;
void (async()=>{
    await test('lease mutual exclusion, bounded wait and cancellation',async()=>{
        const name='io.github.NyongCho.LiquidWidgets.WorkerTest';
        const first=await acquireBusLease(name,0,new Cancellation());
        try{await acquireBusLease(name,0,new Cancellation());throw new Error('duplicate lease');}catch(e){assert(e instanceof LeaseBusyError,'busy type');}
        try{await acquireBusLease(name,30,new Cancellation());throw new Error('unbounded lease');}catch(e){assert(e instanceof LeaseTimeoutError,'timeout type');}
        const cancel=new Cancellation();const cancelled=acquireBusLease(name,1000,cancel);cancel.cancel();
        try{await cancelled;throw new Error('cancel acquired');}catch(e){assert(e instanceof Error&&e.message==='CANCELLED','cancel type');}
        const waiting=acquireBusLease(name,1000,new Cancellation());first.release();
        const next=await waiting;next.release();await delay(20);
    });
    await test('real worker result, clean exit and disposal',async()=>{
        const client=new CalendarWorkerClient(directory);
        const data=await client.run(makeJob(),new Cancellation());assert(data.events.length===1&&data.events[0]?.title==='Sample','result');
        const second=await client.run(makeJob('second'),new Cancellation());assert(second.events.length===1,'reuse');
        await client.dispose();await rejects(client.run(makeJob(),new Cancellation()),'SERVICE_UNAVAILABLE');
    });
    for(const [mode,code] of Object.entries({truncated:'INVALID_DATA',extra:'INVALID_DATA',utf8:'INVALID_DATA',oversize:'PAYLOAD_TOO_LARGE',nonzero:'SERVICE_UNAVAILABLE',hang:'EXPANSION_LIMIT',slow:'EXPANSION_LIMIT',wrongjob:'INVALID_DATA',crash:'SERVICE_UNAVAILABLE',controloversize:'PAYLOAD_TOO_LARGE'})){
        await test(`reject ${mode}, reap before returning`,async()=>{
            const client=new CalendarWorkerClient(directory,{argv:['gjs','-m',`${directory}/workerFixtures.js`,mode],watchdogMs:500});
            await rejects(client.run(makeJob(),new Cancellation()),code);await client.dispose();
        });
    }
    await test('exact 512 KiB response frame remains valid',async()=>{
        const client=new CalendarWorkerClient(directory,{argv:['gjs','-m',`${directory}/workerFixtures.js`,'exactreply']});
        assert((await client.run(makeJob(),new Cancellation())).events.length===0,'exact response');await client.dispose();
    });
    await test('latest pending job replaces stale jobs and cancel reaps within one second',async()=>{
        const client=new CalendarWorkerClient(directory,{argv:['gjs','-m',`${directory}/workerFixtures.js`,'slow'],watchdogMs:2000});
        const start=GLib.get_monotonic_time();const a=new Cancellation();
        const first=client.run(makeJob('one'),a).catch(e=>e);
        await delay(30);
        const second=client.run(makeJob('two'),new Cancellation()).catch(e=>e);
        const thirdCancel=new Cancellation();const third=client.run(makeJob('three'),thirdCancel).catch(e=>e);
        thirdCancel.cancel();await client.dispose();
        for(const p of [first,second,third])assert((await p)?.message==='CANCELLED','cancel stale');
        assert((GLib.get_monotonic_time()-start)/1000<1000,'cancel exit exceeded one second');
    });
    await test('busy waits for session lease, timeout and dispose cancel waits',async()=>{
        const lease=await acquireBusLease('io.github.NyongCho.LiquidWidgets.CalendarJob',0,new Cancellation());
        const client=new CalendarWorkerClient(directory,{busyTimeoutMs:100});
        await rejects(client.run(makeJob(),new Cancellation()),'SERVICE_UNAVAILABLE');
        const pending=client.run(makeJob('wait'),new Cancellation()).catch(e=>e);await delay(30);await client.dispose();
        assert((await pending)?.message==='CANCELLED','busy disposal');lease.release();
        const next=new CalendarWorkerClient(directory);const result=await next.run(makeJob(),new Cancellation());assert(result.events.length===1,'release wake');await next.dispose();
    });
    await test('twenty process replacements do not leak file descriptors',async()=>{
        const count=()=>{const enumerator=Gio.File.new_for_path('/proc/self/fd').enumerate_children('standard::name',Gio.FileQueryInfoFlags.NONE,null);let n=0;while(enumerator.next_file(null))n++;enumerator.close(null);return n;};
        const baseline=count();
        for(let i=0;i<20;i++){const client=new CalendarWorkerClient(directory);const cancel=new Cancellation();const pending=client.run(makeJob(`cycle-${i}`),cancel).catch(e=>e);await delay(20);cancel.cancel();await client.dispose();assert((await pending)?.message==='CANCELLED','cycle cancel');}
        System.gc();await delay(100);const after=count();assert(after<=baseline+1,`FD leak ${baseline}->${after}`);
    });
})().then(()=>{loop.quit();},error=>{printerr(`${String(error)}\n${error instanceof Error?error.stack:''}`);exitCode=1;loop.quit();});
loop.run();System.exit(exitCode);
