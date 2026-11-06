import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';
import {GioLinuxFiles} from '../../src/data/linux.js';
import {SystemProvider} from '../../src/data/providers/system.js';
import {NetworkProvider,listNetworkInterfaces} from '../../src/data/providers/network.js';
import {LocalWidgetSession} from '../../src/data/localSession.js';
import {createPublicDataServices,gioClock} from '../../src/data/runtime.js';
import {ProviderStore} from '../../src/shared/providerStore.js';
import {Cancellation} from '../../src/shared/dataClient.js';
import {defaultConfig} from '../../src/data/config.js';
import type {ProviderContext} from '../../src/data/scheduler.js';
const root=ARGV[0]!,loop=new GLib.MainLoop(null,false);let exitCode=0,time=0,reads=0;
const cancel=()=>new Cancellation(),native=new GioLinuxFiles(root);
const files={readText(path:string,limit:number,cancel:Cancellation){reads++;return native.readText(path,limit,cancel);},listNames:native.listNames.bind(native)};
const timers=new Set<()=>void>();
const clock={...gioClock,monotonic:()=>time,schedule(ms:number,fn:()=>void){let stop=()=>{};const raw=gioClock.schedule(ms,()=>{timers.delete(stop);fn();});stop=()=>{timers.delete(stop);raw();};timers.add(stop);return stop;}};
const context=(name='auto'):ProviderContext=>({config:{...defaultConfig(),networkInterface:name},calendarContext:{month:'2026-11',timeZone:'UTC',weekStart:0},now:'2026-11-04T00:00:00Z',cancel:cancel()});
const wait=(ms:number)=>new Promise<void>(resolve=>GLib.timeout_add(0,ms,()=>{resolve();return GLib.SOURCE_REMOVE;}));
function assert(value:unknown,message:string):asserts value{if(!value)throw new Error(message);}
async function rejects(p:Promise<unknown>,code:string){try{await p;throw new Error('unexpected success');}catch(error){assert(error instanceof Error&&error.message===code,`expected ${code}: ${String(error)}`);}}
void(async()=>{
    const system=new SystemProvider(files,clock),network=new NetworkProvider(files,()=>time);
    const first=await system.collect(context());assert(first.data?.cpuPercent===null&&first.data.memoryUsedBytes===768000&&first.data.temperatureC===38,'first system sample');
    GLib.file_set_contents(`${root}/proc/stat`,new TextDecoder().decode(GLib.file_get_contents(`${root}/stat-next.txt`)[1]));time=2000;
    const second=await system.collect(context());assert(second.data?.cpuPercent===50,'CPU delta');
    const initial=await network.collect(context());assert(initial.data?.interface==='enp5s0'&&initial.data.rxBytesPerSec===null,'physical default route');
    GLib.file_set_contents(`${root}/sys/class/net/enp5s0/statistics/rx_bytes`,String((2n**60n)+2048n));time=4000;
    assert((await network.collect(context())).data?.rxBytesPerSec===1024,'exact large counter delta');
    assert((await network.collect(context('tailscale0'))).data?.interface==='tailscale0','manual VPN interface');
    assert((await listNetworkInterfaces(native,cancel())).includes('tailscale0'),'settings interface list');
    await rejects(native.readText('/proc/fifo',100,cancel()),'INVALID_DATA');await rejects(native.readText('/proc/oversize',1,cancel()),'PAYLOAD_TOO_LARGE');
    network.reset();system.reset();assert((await system.collect(context())).data?.cpuPercent===null,'resume baseline');
    const resources=createPublicDataServices(),store=new ProviderStore();
    const session=new LocalWidgetSession({extensionPath:'/synthetic',store,changed(){},connection(){}},{config:resources.config,clock,drivers:{system,network},destroy:()=>resources.destroy()});
    await session.ready;session.start(['system','network']);
    const deadline=GLib.get_monotonic_time()+2_000_000;while(store.get('system').status!=='ok'||store.get('network').status!=='ok'){assert(GLib.get_monotonic_time()<deadline,'provider deadline');await wait(10);}
    session.stop();const stopped=reads;await wait(50);assert(reads===stopped&&timers.size===0,'no IO or timer after last demand');
    session.destroy();await session.drained;await wait(50);assert(reads===stopped&&timers.size===0,'destroy leaves no sensor polling');
    print(JSON.stringify({test:'GIO CPU/RAM/sensors/large network counters/routes/cancel and no idle polling',success:true}));
})().then(()=>loop.quit(),error=>{printerr(`${String(error)}\n${error instanceof Error?error.stack:''}`);exitCode=1;loop.quit();});
loop.run();System.exit(exitCode);
