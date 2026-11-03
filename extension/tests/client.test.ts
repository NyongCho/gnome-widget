import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DataClient,type Transport,type ChangeHandler,type Cancellation} from '../src/shared/dataClient.js';
import {ProviderStore} from '../src/shared/providerStore.js';
const fixture=()=>JSON.parse(readFileSync(new URL('../../tests/fixtures/protocol/snapshot-valid.json',import.meta.url),'utf8'));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
class Wire implements Transport {
    scheduled=new Map<number,{delay:number;callback:()=>void}>(); private nextTimer=0;
    schedule(delay:number,callback:()=>void){const id=++this.nextTimer;this.scheduled.set(id,{delay,callback});return()=>{this.scheduled.delete(id);};}
    retry(){const entry=this.scheduled.entries().next().value;assert.ok(entry,'missing recovery timer');const [id,timer]=entry;this.scheduled.delete(id);timer.callback();return timer.delay;}
    owner:((owner:string|null)=>void)|null=null; changes=new Map<string,ChangeHandler>();
    pending:{owner:string;method:string;args:readonly unknown[];cancel:Cancellation|null;resolve:(value:readonly unknown[])=>void;reject:(e:Error)=>void}[]=[];
    watchOwner(cb:(owner:string|null)=>void){this.owner=cb;return()=>{this.owner=null;};}
    watchChanges(owner:string,cb:ChangeHandler){this.changes.set(owner,cb);return()=>{this.changes.delete(owner);};}
    call(owner:string,method:string,args:readonly unknown[],cancel:Cancellation|null):Promise<readonly unknown[]>{return new Promise((resolve,reject)=>this.pending.push({owner,method,args,cancel,resolve,reject}));}
    take(method:string,owner=':1.1'){const i=this.pending.findIndex(p=>p.method===method&&p.owner===owner);assert.notEqual(i,-1,`missing ${method} for ${owner}`);return this.pending.splice(i,1)[0]!;}
}
test('signal subscription precedes snapshot and newer revisions win',async()=>{
    const wire=new Wire(),store=new ProviderStore(),client=new DataClient(wire,store,()=>{},()=>{});
    client.start(['system']);wire.owner!(':1.1');assert.ok(wire.changes.has(':1.1'));
    wire.take('Subscribe').resolve(['token']);await tick();
    const data=fixture();wire.changes.get(':1.1')!('system',4,JSON.stringify({...data.system,status:'stale',errorCode:'NETWORK_ERROR'}));
    wire.take('GetSnapshot').resolve([JSON.stringify(data)]);await tick();
    assert.equal(store.get('system').status,'stale');client.stop();
    assert.deepEqual(wire.take('Unsubscribe').args,['token']);
});
test('late_old_owner_response_is_discarded and reconnect accepts revision 1',async()=>{
    const wire=new Wire(),store=new ProviderStore(),states:string[]=[];
    const client=new DataClient(wire,store,()=>{},s=>states.push(s));client.start(['system']);wire.owner!(':1.1');
    wire.take('Subscribe').resolve(['old']);await tick();const old=wire.take('GetSnapshot');
    wire.owner!(':1.2');wire.take('Subscribe',':1.2').resolve(['new']);await tick();
    const data=fixture();data.system.data.cpuPercent=12;data.revisions.system=1;
    wire.take('GetSnapshot',':1.2').resolve([JSON.stringify(data)]);await tick();
    old.resolve([JSON.stringify(fixture())]);await tick();
    assert.equal(store.get('system').data?.cpuPercent,12);assert.equal(old.cancel?.cancelled,true);
    wire.owner!(null);assert.equal(store.get('system').data?.cpuPercent,12);assert.equal(states.at(-1),'disconnected');client.stop();
});
test('disable during Subscribe releases late token to original owner',async()=>{
    const wire=new Wire(),client=new DataClient(wire,new ProviderStore(),()=>{},()=>{});
    client.start(['system']);wire.owner!(':1.1');const pending=wire.take('Subscribe');
    client.stop();pending.resolve(['late-token']);await tick();
    assert.deepEqual(wire.take('Unsubscribe').args,['late-token']);assert.equal(wire.changes.size,0);assert.equal(wire.owner,null);
    assert.equal(wire.pending.some(p=>p.method==='GetSnapshot'),false);
});
test('disable and enable discard the previous generation even with the same owner',async()=>{
    const wire=new Wire(),store=new ProviderStore(),client=new DataClient(wire,store,()=>{},()=>{});
    client.start(['system']);wire.owner!(':1.1');wire.take('Subscribe').resolve(['first']);await tick();const first=wire.take('GetSnapshot');
    client.stop();client.start(['system']);wire.owner!(':1.1');wire.take('Subscribe').resolve(['second']);await tick();
    const fresh=fixture();fresh.system.data.cpuPercent=77;wire.take('GetSnapshot').resolve([JSON.stringify(fresh)]);await tick();
    first.resolve([JSON.stringify(fixture())]);await tick();assert.equal(store.get('system').data?.cpuPercent,77);client.stop();
});
test('malformed signals cannot replace current data or leak error contents',async()=>{
    const wire=new Wire(),store=new ProviderStore(),status:string[]=[];
    const client=new DataClient(wire,store,()=>{},s=>status.push(s));client.start(['system']);wire.owner!(':1.1');
    wire.take('Subscribe').resolve(['token']);await tick();wire.take('GetSnapshot').resolve([JSON.stringify(fixture())]);await tick();
    const old=store.get('system');wire.changes.get(':1.1')!('system',3,'private-secret');
    assert.equal(store.get('system'),old);assert.equal(status.at(-1),'invalid-data');assert.ok(status.every(s=>!s.includes('secret')));client.stop();
});

test('transient snapshot failure recovers without a bus owner change',async()=>{
    const wire=new Wire(),store=new ProviderStore(),client=new DataClient(wire,store,()=>{},()=>{});
    client.start(['system']);wire.owner!(':1.1');wire.take('Subscribe').resolve(['first']);await tick();
    wire.take('GetSnapshot').reject(new Error('temporary failure'));await tick();
    assert.deepEqual(wire.take('Unsubscribe').args,['first']);
    assert.equal(wire.retry(),1000);
    wire.take('Subscribe').resolve(['recovered']);await tick();
    const data=fixture();data.system.data.cpuPercent=31;
    wire.take('GetSnapshot').resolve([JSON.stringify(data)]);await tick();
    assert.equal(store.get('system').data?.cpuPercent,31);assert.equal(wire.scheduled.size,0);client.stop();
});
test('failed subscribe retries with bounded backoff and disable cancels recovery',async()=>{
    const wire=new Wire(),client=new DataClient(wire,new ProviderStore(),()=>{},()=>{});
    client.start(['system']);wire.owner!(':1.1');
    for(const delay of [1000,2000,4000,8000,16000,30000,30000]){
        wire.take('Subscribe').reject(new Error('temporary'));await tick();assert.equal(wire.retry(),delay);
    }
    wire.take('Subscribe').reject(new Error('temporary'));await tick();assert.equal(wire.scheduled.size,1);
    client.stop();assert.equal(wire.scheduled.size,0);
});
test('owner change cancels retry scheduled for a previous owner',async()=>{
    const wire=new Wire(),client=new DataClient(wire,new ProviderStore(),()=>{},()=>{});
    client.start(['system']);wire.owner!(':1.1');wire.take('Subscribe').reject(new Error('temporary'));await tick();
    wire.owner!(':1.2');assert.equal(wire.scheduled.size,0);wire.take('Subscribe',':1.2');client.stop();
});

test('calendar context is sent before subscribe, serialized on change and refreshed at midnight',async()=>{
 const wire=new Wire(),client=new DataClient(wire,new ProviderStore(),()=>{},()=>{});
 const context={month:'2026-11',timeZone:'Asia/Seoul',weekStart:1};client.setCalendarContext(context,'2026-11-04');client.start(['calendar']);wire.owner!(':1.1');
 const first=wire.take('SetCalendarContext');assert.deepEqual(first.args,[JSON.stringify(context)]);first.resolve([]);await tick();
 wire.take('Subscribe').resolve(['calendar-token']);await tick();wire.take('GetSnapshot').resolve([JSON.stringify(fixture())]);await tick();
 client.setCalendarContext(context,'2026-11-04');await tick();assert.equal(wire.pending.length,0);
 client.setCalendarContext(context,'2026-11-05');wire.take('SetCalendarContext').resolve([]);await tick();wire.take('Refresh').resolve([]);await tick();
 client.setCalendarContext({...context,timeZone:'UTC'},'2026-11-05');const old=wire.take('SetCalendarContext');
 client.setCalendarContext({...context,timeZone:'America/New_York'},'2026-11-05');assert.equal(wire.pending.length,0);old.resolve([]);await tick();
 const last=wire.take('SetCalendarContext');assert.ok(String(last.args[0]).includes('America/New_York'));last.resolve([]);await tick();client.stop();
});
test('resume refreshes subscribed remote data, marks old data pending, retries failure and cancels on disable',async()=>{
 const wire=new Wire(),store=new ProviderStore(),client=new DataClient(wire,store,()=>{},()=>{});
 client.start(['calendar','weather','system']);wire.owner!(':1.1');wire.take('Subscribe').resolve(['token']);await tick();
 const data=fixture();wire.take('GetSnapshot').resolve([JSON.stringify(data)]);await tick();
 client.refreshAfterResume();
 const requests=wire.pending.filter(p=>p.method==='Refresh');assert.deepEqual(requests.map(p=>p.args[0]).sort(),['calendar','weather']);
 assert.equal(store.get('weather').status,'loading');assert.equal(store.get('weather').updatedAt,data.weather.updatedAt);assert.deepEqual(store.get('weather').data,data.weather.data);
 wire.take('Refresh').resolve([]);wire.take('Refresh').reject(new Error('rate limited'));await tick();assert.equal(wire.retry(),60000);
 wire.take('Refresh').reject(new Error('temporary'));await tick();assert.equal(wire.scheduled.size,1);
 wire.changes.get(':1.1')!('weather',10,JSON.stringify({...data.weather,status:'ok',errorCode:null}));assert.equal(store.get('weather').status,'ok');
 client.stop();assert.equal(wire.scheduled.size,0);
});
test('resume does not refresh hidden or unconfigured providers',async()=>{
 const wire=new Wire(),client=new DataClient(wire,new ProviderStore(),()=>{},()=>{});client.start(['system']);wire.owner!(':1.1');wire.take('Subscribe').resolve(['token']);await tick();wire.take('GetSnapshot').resolve([JSON.stringify(fixture())]);await tick();
 client.refreshAfterResume();assert.equal(wire.pending.length,0);client.stop();
});
