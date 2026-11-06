import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SystemSampler,SystemProvider,readTemperature} from '../src/data/providers/system.js';
import {NetworkSampler,NetworkProvider,defaultInterface,listNetworkInterfaces} from '../src/data/providers/network.js';
import type {LinuxFiles} from '../src/data/contracts.js';
import {Cancellation} from '../src/shared/dataClient.js';
import {defaultConfig} from '../src/data/config.js';
import {DataFailure} from '../src/data/errors.js';
import type {ProviderContext} from '../src/data/scheduler.js';
const fixture=(name:string)=>readFileSync(new URL(`../../tests/fixtures/${name}`,import.meta.url),'utf8');
const stat=fixture('system/stat-first.txt'),next=fixture('system/stat-next.txt'),mem=fixture('system/meminfo.txt');
const cancel=()=>new Cancellation();
function context(name='auto'):ProviderContext{return{config:{...defaultConfig(),networkInterface:name},calendarContext:{month:'2026-11',timeZone:'UTC',weekStart:0},now:'2026-11-04T00:00:00Z',cancel:cancel()};}
function fakeFiles(){const files=new Map<string,string>(),dirs=new Map<string,string[]>();let reads=0;const io:LinuxFiles={async readText(path){reads++;if(!files.has(path))throw new DataFailure('SERVICE_UNAVAILABLE');return files.get(path)!;},async listNames(path){return dirs.get(path)??[];}};return{files,dirs,io,get reads(){return reads;}};}
test('CPU first sample, MemAvailable, guest exclusion and reset preserve Rust semantics',()=>{
    const sampler=new SystemSampler();const first=sampler.sample(stat,mem,null);assert.equal(first.cpuPercent,null);assert.equal(first.memoryTotalBytes,1024000);assert.equal(first.memoryUsedBytes,768000);
    assert.equal(sampler.sample(next,mem,38).cpuPercent,50);assert.equal(sampler.sample(stat,mem,null).cpuPercent,null);
    const large=2n**54n;const big=new SystemSampler();big.sample(`cpu ${large} 0 0 ${large} 0 0 0 0 9000 9000`,mem,null);
    assert.equal(big.sample(`cpu ${large+1n} 0 0 ${large+1n} 0 0 0 0 10000 10000`,mem,null).cpuPercent,50);
    assert.throws(()=>big.sample(next,'MemTotal: 9007199254740991 kB\nMemAvailable: 0 kB',null),/INVALID_DATA/);
});
test('CPU sensor chooses package/Tdie before core/Tctl and excludes NVMe',async()=>{
    const f=fakeFiles();f.dirs.set('/sys/class/hwmon',['hwmon0','hwmon1','hwmon2']);
    for(const [index,chip,label,value] of [[0,'nvme','Composite','99000'],[1,'coretemp','Package id 0','38000'],[2,'coretemp','Core 0','42000']] as const){const dir=`/sys/class/hwmon/hwmon${index}`;f.files.set(`${dir}/name`,chip);f.dirs.set(dir,['temp1_label','temp1_input']);f.files.set(`${dir}/temp1_label`,label);f.files.set(`${dir}/temp1_input`,value);}
    assert.equal(await readTemperature(f.io,cancel()),38);f.files.set('/sys/class/hwmon/hwmon1/name','k10temp');f.files.set('/sys/class/hwmon/hwmon1/temp1_label','Tdie');assert.equal(await readTemperature(f.io,cancel()),38);
    f.files.set('/sys/class/hwmon/hwmon1/temp1_input','0x10');assert.equal(await readTemperature(f.io,cancel()),42,'malformed preferred sensor falls back to a valid core');
    assert.equal(await readTemperature(fakeFiles().io,cancel()),null);
});
test('network preserves exact deltas above 2^53 and uses elapsed monotonic time',()=>{
    const sampler=new NetworkSampler(),large=2n**60n;
    assert.equal(sampler.sample('eth0',large,large,0,'2026-11-04T00:00:00Z').rxBytesPerSec,null);
    const second=sampler.sample('eth0',large+2048n,large+4096n,2000,'2026-11-04T00:00:02Z');assert.equal(second.rxBytesPerSec,1024);assert.equal(second.txBytesPerSec,2048);
    assert.equal(sampler.sample('eth0',large+2048n,large+4096n,4000,'2026-11-04T00:00:04Z').rxBytesPerSec,0);
    assert.equal(sampler.sample('tailscale0',500n,500n,6000,'2026-11-04T00:00:06Z').history.length,0);
    assert.equal(sampler.sample('tailscale0',0n,0n,8000,'2026-11-04T00:00:08Z').rxBytesPerSec,null);
});
test('network history is limited to sixty seconds and sixty samples',()=>{
    const sampler=new NetworkSampler();let data;
    for(let i=0;i<=32;i++)data=sampler.sample('eth0',BigInt(i*100),BigInt(i*50),i*2000,new Date(Date.UTC(2026,10,4)+i*2000).toISOString());
    assert.equal(data!.history.length,31);assert.equal(data!.history[0]!.at,'2026-11-04T00:00:04.000Z');
});
test('route selection prefers IPv4 and lowest metric, falls back to IPv6, excludes automatic Tailscale',()=>{
    assert.equal(defaultInterface(fixture('network/route.txt'),''),'enp5s0');assert.equal(defaultInterface('',''),null);
    const route=(name:string,metric:string,flags='00000001')=>`00000000000000000000000000000000 00 00000000000000000000000000000000 00 00000000000000000000000000000000 ${metric} 00000000 00000000 ${flags} ${name}`;
    assert.equal(defaultInterface('',[route('tailscale0','00000000'),route('eth0','00000010'),route('wlan0','00000020')].join('\n')),'eth0');
    assert.equal(defaultInterface('',route('eth0','00000000','00000201')),null);
    assert.equal(defaultInterface('',route('eth0','00000000','100000001')),null);
});
test('manual Tailscale is allowed and disappearance resets network history',async()=>{
    const f=fakeFiles();let now=0;const provider=new NetworkProvider(f.io,()=>now);
    f.files.set('/sys/class/net/tailscale0/statistics/rx_bytes','1000');f.files.set('/sys/class/net/tailscale0/statistics/tx_bytes','2000');
    assert.equal((await provider.collect(context('tailscale0'))).data?.interface,'tailscale0');now=2000;f.files.set('/sys/class/net/tailscale0/statistics/rx_bytes','3000');assert.equal((await provider.collect(context('tailscale0'))).data?.rxBytesPerSec,1000);
    f.files.delete('/sys/class/net/tailscale0/statistics/rx_bytes');await assert.rejects(provider.collect(context('tailscale0')),/NO_INTERFACE/);f.files.set('/sys/class/net/tailscale0/statistics/rx_bytes','5000');now=4000;
    assert.equal((await provider.collect(context('tailscale0'))).data?.rxBytesPerSec,null);provider.reset();now=6000;assert.equal((await provider.collect(context('tailscale0'))).data?.history.length,0);
    await assert.rejects(provider.collect(context('../escape')),/INVALID_DATA/);
    f.dirs.set('/sys/class/net',['lo','tailscale0','eth0','../bad']);assert.deepEqual(await listNetworkInterfaces(f.io,cancel()),['eth0','lo','tailscale0']);
});
test('temperature is measured at most once per five seconds; resume resets CPU baseline',async()=>{
    const f=fakeFiles();let now=0,sensors=0;f.files.set('/proc/stat',stat);f.files.set('/proc/meminfo',mem);
    const provider=new SystemProvider(f.io,{monotonic:()=>now,now:()=>new Date().toISOString(),schedule(){return()=>{};}},async()=>{sensors++;return 38;});
    assert.equal((await provider.collect(context())).data?.cpuPercent,null);now=2000;f.files.set('/proc/stat',next);assert.equal((await provider.collect(context())).data?.cpuPercent,50);assert.equal(sensors,1);
    now=4999;await provider.collect(context());assert.equal(sensors,1);now=5000;await provider.collect(context());assert.equal(sensors,2);
    provider.reset();assert.equal((await provider.collect(context())).data?.cpuPercent,null);
});
