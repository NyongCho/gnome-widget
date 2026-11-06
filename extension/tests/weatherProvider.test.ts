import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {parseLocations,parseForecast,LocationSearch,WeatherProvider} from '../src/data/providers/weather.js';
import {Cancellation} from '../src/shared/dataClient.js';
import {ConfigStore,defaultConfig} from '../src/data/config.js';
import {DataSettingsService} from '../src/data/settings.js';
import {DataFailure} from '../src/data/errors.js';
import type {HttpClient,PrivateFiles,SecretStore} from '../src/data/contracts.js';
import {ProviderScheduler,type ProviderContext} from '../src/data/scheduler.js';
import type {ProviderMap,WeatherLocation} from '../src/types.js';
const forecast=readFileSync(new URL('../../tests/fixtures/weather/forecast.json',import.meta.url));
const locations=readFileSync(new URL('../../tests/fixtures/weather/locations.json',import.meta.url));
const location:WeatherLocation={id:'1835848',label:'서울',latitude:37.566,longitude:126.9784,timeZone:'Asia/Seoul'};
const bytes=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value));
const cancel=()=>new Cancellation();
const flush=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
function setup(){
    const map=new Map<string,Uint8Array>();
    const files:PrivateFiles={async read(name){return map.get(name)??null;},async replace(name,value){map.set(name,value);},async remove(name){map.delete(name);}};
    const config=new ConfigStore({files,uuid:randomUUID,watch(){return()=>{};},async acquire(){return{release(){}};}});
    const secret:SecretStore={async lookup(){return null;},async save(){},async remove(){},async clearAll(){}};
    const settings=new DataSettingsService(config,secret,files,randomUUID);
    const requests:{url:string;limits:{maxBytes:number;timeoutMs:number}}[]=[];let response:()=>Promise<Uint8Array>=async()=>forecast;
    const http:HttpClient={async get(url,limits){requests.push({url,limits});return response();}};
    const provider=new WeatherProvider(http,files,config);
    return{config,settings,map,requests,http,provider,set response(fn:()=>Promise<Uint8Array>){response=fn;},async context():Promise<ProviderContext>{return{config:await config.read(cancel()),calendarContext:{month:'2026-11',timeZone:'UTC',weekStart:0},now:'2026-11-04T14:30:00Z',cancel:cancel()};}};
}
test('Rust weather fixtures preserve coordinates, local timezone, nulls and numeric zero',()=>{
    const found=parseLocations(locations);assert.equal(found.length,1);assert.equal(found[0]?.timeZone,'Asia/Seoul');assert.equal(found[0]?.latitude,37.566);assert.match(found[0]!.label,/대한민국/);
    assert.deepEqual(parseLocations(bytes({})),[]);assert.throws(()=>parseLocations(bytes({error:true})));
    const data=parseForecast(forecast,location,1793802600);
    assert.equal(data.current.temperatureC,null);assert.equal(data.current.code,3);assert.equal(data.hourly.length,6);assert.equal(data.hourly[0]?.at,'2026-11-04T15:00:00Z');
    assert.equal(data.hourly[1]?.temperatureC,null);assert.equal(data.hourly[1]?.precipitationProbability,null);assert.equal(data.hourly[2]?.temperatureC,0);assert.equal(data.timeZone,'Asia/Seoul');
    assert.equal(parseForecast(bytes({current:{},hourly:{time:[1793804400]}}),location,1793802600).hourly[0]?.temperatureC,null);
    assert.throws(()=>parseForecast(bytes({hourly:{time:'broken'}}),location,0));assert.throws(()=>parseForecast(new Uint8Array(262145),location,0));
});
test('requests use fixed HTTPS endpoints, UTC epoch data and 256 KiB/15 second bounds',async()=>{
    const f=setup();await f.settings.setWeatherLocation(location,cancel());await f.provider.collect(await f.context());
    const request=f.requests[0]!,url=new URL(request.url);assert.equal(url.origin,'https://api.open-meteo.com');assert.equal(url.searchParams.get('timeformat'),'unixtime');assert.equal(url.searchParams.get('forecast_hours'),'7');assert.deepEqual(request.limits,{maxBytes:262144,timeoutMs:15000});
    f.response=async()=>{throw new DataFailure('RATE_LIMITED');};const state=await f.provider.collect(await f.context());assert.equal(state.errorCode,'RATE_LIMITED');assert.equal(state.status,'stale');
});
test('offline cache preserves last success time across provider instances and clear removes it',async()=>{
    const f=setup();await f.settings.setWeatherLocation(location,cancel());const first=await f.provider.collect(await f.context());
    f.response=async()=>{throw new DataFailure('NETWORK_ERROR');};const context=await f.context();context.now='2026-11-05T12:00:00Z';
    const stale=await new WeatherProvider(f.http,{async read(n){return f.map.get(n)??null;},async replace(){},async remove(){}},f.config).collect(context);
    assert.equal(stale.status,'stale');assert.equal(stale.updatedAt,first.updatedAt);assert.deepEqual(stale.data,first.data);
    await f.settings.setWeatherLocation(null,cancel());assert.equal(f.map.has('weather.json'),false);assert.equal((await f.provider.collect(await f.context())).status,'unconfigured');
});
test('city A late response never overwrites city B cache',async()=>{
    const f=setup();await f.settings.setWeatherLocation(location,cancel());let finish!:(value:Uint8Array)=>void;f.response=()=>new Promise(resolve=>{finish=resolve;});
    const old=f.provider.collect(await f.context());await flush();await f.settings.setWeatherLocation({...location,id:'b',label:'B'},cancel());finish(forecast);
    await assert.rejects(old,/CANCELLED/);assert.equal(f.map.has('weather.json'),false);
});
test('location search permits one active query, one per second, and at most twenty results',async()=>{
    const f=setup();let time=0,finish!:(value:Uint8Array)=>void;f.response=()=>new Promise(resolve=>{finish=resolve;});const search=new LocationSearch(f.http,()=>time);
    const first=search.searchLocations('서울',cancel());await flush();await assert.rejects(search.searchLocations('Busan',cancel()),/RATE_LIMITED/);finish(locations);assert.equal((await first).length,1);
    await assert.rejects(search.searchLocations('서울',cancel()),/RATE_LIMITED/);time=1000;f.response=async()=>locations;await search.searchLocations('서울',cancel());
    assert.equal(new URL(f.requests[0]!.url).origin,'https://geocoding-api.open-meteo.com');
    assert.equal(parseLocations(bytes({results:Array.from({length:30},(_,id)=>({id,name:'A',latitude:1,longitude:2,timezone:'UTC'}))})).length,20);
    await assert.rejects(search.searchLocations('x',cancel()),/INVALID_DATA/);
});
test('weather scheduling backs off 30 to 900 seconds and resets after success',async()=>{
    let delay=0,tick=()=>{},success=false;
    let state:ProviderMap['weather']={status:'loading',sourceId:'test',updatedAt:null,data:null,errorCode:null};
    const config={...defaultConfig(),weather:{sourceId:'test',location}};
    const scheduler=new ProviderScheduler('weather',{async collect(context){if(!success)throw new DataFailure('NETWORK_ERROR');return{status:'ok',sourceId:'test',updatedAt:context.now,errorCode:null,data:parseForecast(forecast,location,1793802600)};}},{monotonic:()=>0,now:()=>new Date(1793802600*1000).toISOString(),schedule(ms,fn){delay=ms;tick=fn;return()=>{};}},()=>state,(_r,next)=>{state=next;});
    scheduler.configure({config,calendarContext:{month:'2026-11',timeZone:'UTC',weekStart:0}},'test',true);await flush();assert.equal(delay,30000);
    tick();await flush();assert.equal(delay,60000);for(let i=0;i<8;i++){tick();await flush();}assert.equal(delay,900000);
    success=true;tick();await flush();assert.equal(state.status,'ok');assert.equal(delay,900000);scheduler.destroy();
});
