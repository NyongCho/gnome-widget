import test from 'node:test';
import assert from 'node:assert/strict';
import {MediaProvider,type MprisBus,type PlayerSnapshot} from '../src/data/providers/media.js';
import {ArtworkLoader,type ArtworkStore,artworkKind} from '../src/data/providers/mediaArt.js';
import {Cancellation} from '../src/shared/dataClient.js';
import {DataFailure} from '../src/data/errors.js';
import type {SessionClock} from '../src/data/localSession.js';
import type {ProviderMap} from '../src/types.js';
const tick=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
function clock(){let now=0;const timers=new Map<()=>void,number>();return{monotonic:()=>now,now:()=>new Date(now).toISOString(),schedule(ms,fn){timers.set(fn,now+ms);return()=>{timers.delete(fn);};},advance(ms:number){now+=ms;for(const[fn,at]of timers)if(at<=now){timers.delete(fn);fn();}},timers} satisfies SessionClock&{advance(ms:number):void;timers:Map<()=>void,number>};}
const player=(title:string,status='Playing',artUri:string|null=null):PlayerSnapshot=>({identity:'Spotify',status,title,artist:'Artist',artUri,trackId:title});
function bus(){const entries=new Map<string,{owner:string;snapshot:PlayerSnapshot}>();let listener:Parameters<MprisBus['watch']>[0]|null=null,reads=0;const io:MprisBus={async listNames(){return[...entries.keys()];},async getOwner(name){return entries.get(name)!.owner;},async read(owner){reads++;return[...entries.values()].find(e=>e.owner===owner)!.snapshot;},watch(fn){listener=fn;return()=>{listener=null;};}};return{entries,io,event(event:Parameters<Parameters<MprisBus['watch']>[0]>[0]){listener?.(event);},get watching(){return!!listener;},get reads(){return reads;}};}
test('MPRIS selects playing only, bounds discovery, switches owners and removes stopped players',async()=>{
    const b=bus(),c=clock(),cancel=new Cancellation(),states:ProviderMap['media'][]=[];
    for(let i=0;i<40;i++)b.entries.set(`org.mpris.MediaPlayer2.p${String(i).padStart(2,'0')}`,{owner:`:1.${i}`,snapshot:player(String(i),i===1?'Playing':'Paused')});
    const provider=new MediaProvider(b.io,{loadArtwork:async()=>null},c);provider.start(s=>states.push(s),cancel);await tick();assert.equal(b.reads,32);assert.equal(states.at(-1)?.data?.title,'1');
    const name='org.mpris.MediaPlayer2.p01';b.entries.set(name,{owner:':2.1',snapshot:player('replacement')});b.event({kind:'owner',name,oldOwner:':1.1',newOwner:':2.1'});await tick();assert.equal(states.at(-1)?.data?.title,'replacement');
    b.entries.get(name)!.snapshot=player('replacement','Paused');b.event({kind:'properties',owner:':2.1'});await tick();assert.equal(states.at(-1)?.errorCode,'NO_PLAYER');assert.equal(states.at(-1)?.data,null);
    cancel.cancel();const count=states.length;b.event({kind:'properties',owner:':2.1'});await tick();assert.equal(states.length,count);assert.equal(b.watching,false);assert.equal(c.timers.size,0);
});
test('late track A artwork and late old-owner properties cannot overwrite track B',async()=>{
    const b=bus(),cancel=new Cancellation(),states:ProviderMap['media'][]=[];let resolveA!:(uri:string|null)=>void,artCancel:Cancellation|undefined;
    const name='org.mpris.MediaPlayer2.test';b.entries.set(name,{owner:':1.2',snapshot:player('A','Playing','https://example.org/A')});
    const provider=new MediaProvider(b.io,{loadArtwork:async(uri,c)=>{if(uri.endsWith('/A')){artCancel=c;return new Promise(resolve=>{resolveA=resolve;});}return'file:///B';}},clock());
    provider.start(s=>states.push(s),cancel);await tick();assert.equal(states.at(-1)?.data?.title,'A');
    b.entries.get(name)!.snapshot=player('B','Playing','https://example.org/B');b.event({kind:'properties',owner:':1.2'});await tick();assert.equal(artCancel?.cancelled,true);assert.equal(states.at(-1)?.data?.artUri,'file:///B');
    resolveA('file:///A');await tick();assert.equal(states.at(-1)?.data?.artUri,'file:///B');cancel.cancel();
});
test('concurrent property signals coalesce and disable cancels pending reads',async()=>{
    const b=bus(),name='org.mpris.MediaPlayer2.test',cancel=new Cancellation();b.entries.set(name,{owner:':1.2',snapshot:player('A')});
    let done!:(snapshot:PlayerSnapshot)=>void,readCancel:Cancellation|undefined,count=0;const original=b.io.read;b.io.read=async(owner,c)=>{count++;if(count===1)return original(owner,c);readCancel=c;return new Promise(resolve=>{done=resolve;});};
    const states:ProviderMap['media'][]=[];new MediaProvider(b.io,{loadArtwork:async()=>null},clock()).start(s=>states.push(s),cancel);await tick();
    for(let i=0;i<100;i++)b.event({kind:'properties',owner:':1.2'});assert.equal(count,2);cancel.cancel();assert.equal(readCancel?.cancelled,true);const length=states.length;done(player('late'));await tick();assert.equal(states.length,length);assert.equal(count,2);
});
function store(){const cache=new Map<string,string>();const io:ArtworkStore={async local(uri){return uri==='file:///valid.png'?uri:null;},async cached(uri){return cache.get(uri)??null;},async put(uri,bytes){assert.ok(bytes.length>0&&bytes.length<=8*1024*1024);cache.set(uri,'file:///private/art');return'file:///private/art';}};return{io,cache};}
test('art URI policy excludes credentials, fragments, non-HTTPS and remote file hosts',()=>{
    for(const value of ['','http://a/a','data:image/png,x','https://u:p@a/a','https://a/a#x','file://host/a','https://a/\nx','https://a/'+ 'a'.repeat(4096)])assert.equal(artworkKind(value),null,value);
    assert.equal(artworkKind('https://i.scdn.co/image/test'),'remote');assert.equal(artworkKind('file:///valid.png'),'local');
});
test('artwork retries network once after 2s, cools failures for 60s, bounds downloads and reuses cache',async()=>{
    const c=clock(),s=store(),cancel=new Cancellation();let requests=0,fail=true;
    const loader=new ArtworkLoader({async get(_uri,limits){assert.deepEqual(limits,{maxBytes:8*1024*1024,timeoutMs:5000});requests++;if(fail)throw new DataFailure('NETWORK_ERROR');return new Uint8Array([1]);}},s.io,c);
    const first=loader.loadArtwork('https://example.org/art',cancel);await tick();assert.equal(requests,1);c.advance(1999);await tick();assert.equal(requests,1);c.advance(1);await tick();assert.equal(await first,null);assert.equal(requests,2);
    await loader.loadArtwork('https://example.org/art',cancel);assert.equal(requests,2);c.advance(60000);fail=false;assert.equal(await loader.loadArtwork('https://example.org/art',cancel),'file:///private/art');assert.equal(requests,3);
    assert.equal(await loader.loadArtwork('https://example.org/art',cancel),'file:///private/art');assert.equal(requests,3);assert.equal(await loader.loadArtwork('file:///valid.png',cancel),'file:///valid.png');assert.equal(await loader.loadArtwork('file:///broken',cancel),null);
});
test('empty/oversize artwork never publishes; cancellation removes retry timers',async()=>{
    const c=clock(),s=store(),cancel=new Cancellation();let bytes=new Uint8Array();const loader=new ArtworkLoader({async get(){return bytes;}},s.io,c);
    assert.equal(await loader.loadArtwork('https://example.org/empty',cancel),null);bytes=new Uint8Array(8*1024*1024+1);assert.equal(await loader.loadArtwork('https://example.org/large',cancel),null);assert.equal(s.cache.size,0);
    const pending=new ArtworkLoader({async get(){throw new DataFailure('NETWORK_ERROR');}},s.io,c).loadArtwork('https://example.org/cancel',cancel);await tick();assert.equal(c.timers.size,1);cancel.cancel();await assert.rejects(pending,/CANCELLED/);assert.equal(c.timers.size,0);
});
test('art completion rechecks the real metadata even when its change signal is delayed',async()=>{
    const b=bus(),name='org.mpris.MediaPlayer2.test',cancel=new Cancellation(),states:ProviderMap['media'][]=[];let finish!:(uri:string)=>void;
    b.entries.set(name,{owner:':1.2',snapshot:player('A','Playing','https://example.org/A')});
    new MediaProvider(b.io,{loadArtwork:()=>new Promise(resolve=>{finish=resolve;})},clock()).start(s=>states.push(s),cancel);await tick();
    b.entries.get(name)!.snapshot=player('B');finish('file:///A');await tick();assert.equal(states.at(-1)?.data?.title,'B');assert.equal(states.at(-1)?.data?.artUri,null);cancel.cancel();
});
test('simultaneous artwork consumers share a fetch and one consumer may cancel independently',async()=>{
    const c=clock(),s=store();let calls=0,finish!:(bytes:Uint8Array)=>void;const loader=new ArtworkLoader({get(){calls++;return new Promise(resolve=>{finish=resolve;});}},s.io,c);
    const one=new Cancellation(),two=new Cancellation();const a=loader.loadArtwork('https://example.org/shared',one),b=loader.loadArtwork('https://example.org/shared',two);await tick();assert.equal(calls,1);one.cancel();await assert.rejects(a,/CANCELLED/);finish(new Uint8Array([1]));assert.equal(await b,'file:///private/art');assert.equal(c.timers.size,0);
});
test('a hung artwork transport is bounded at five seconds per attempt',async()=>{
    const c=clock(),s=store();let calls=0,canceled=0;const loader=new ArtworkLoader({get(_uri,_limits,cancel){calls++;cancel.onCancel(()=>canceled++);return new Promise(()=>{});}},s.io,c);
    const pending=loader.loadArtwork('https://example.org/hang',new Cancellation());await tick();c.advance(5000);await tick();assert.equal(canceled,1);c.advance(2000);await tick();assert.equal(calls,2);c.advance(5000);await tick();assert.equal(await pending,null);assert.equal(canceled,2);assert.equal(c.timers.size,0);
});
