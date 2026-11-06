import GLib from 'gi://GLib';
import System from 'system';
import {createPublicDataServices} from '../../src/data/runtime.js';
import {LocalWidgetSession} from '../../src/data/localSession.js';
import {LocationSearch,WeatherProvider} from '../../src/data/providers/weather.js';
import {SoupHttpClient} from '../../src/data/http.js';
import type {HttpClient} from '../../src/data/contracts.js';
import {ProviderStore} from '../../src/shared/providerStore.js';
import {Cancellation} from '../../src/shared/dataClient.js';
const origin=ARGV[0]!,loop=new GLib.MainLoop(null,false);let exitCode=0;
const cancel=()=>new Cancellation();
function assert(value:unknown,message:string):asserts value {if(!value)throw new Error(message);}
const delay=(ms:number)=>new Promise<void>(resolve=>GLib.timeout_add(0,ms,()=>{resolve();return GLib.SOURCE_REMOVE;}));
async function until(fn:()=>boolean){const deadline=GLib.get_monotonic_time()+2_000_000;while(!fn()){assert(GLib.get_monotonic_time()<deadline,'state deadline');await delay(10);}}
void(async()=>{
    const resources=createPublicDataServices(),http=new SoupHttpClient();
    const wire:HttpClient={get(url,limits,cancel){assert(/^https:\/\/(?:geocoding-api|api)\.open-meteo\.com\//.test(url),'fixed provider host');return http.get(`${origin}/${url.includes('/search?')?'search':'forecast'}`,limits,cancel);}};
    const search=new LocationSearch(wire,resources.clock.monotonic),provider=new WeatherProvider(wire,resources.cache,resources.config),store=new ProviderStore();
    const locations=await search.searchLocations('서울',cancel());assert(locations.length===1,'location search');
    await resources.settings.setWeatherLocation(locations[0]!,cancel());
    const clock={...resources.clock,now:()=> '2026-11-04T14:30:00Z'};
    const session=new LocalWidgetSession({extensionPath:'/synthetic',store,changed(){},connection(){}},{config:resources.config,clock,drivers:{weather:provider},destroy:()=>resources.destroy()});
    await session.ready;session.start(['weather']);await until(()=>store.get('weather').status==='ok');const first=store.get('weather');
    assert(first.data?.hourly.length===6&&first.data.hourly[1]?.temperatureC===null&&first.data.hourly[2]?.temperatureC===0,'weather semantics');
    await http.get(`${origin}/offline`,{maxBytes:100,timeoutMs:1000},cancel());await delay(1100);
    try{await search.searchLocations('서울',cancel());throw new Error('search should fail');}catch(error){assert(error instanceof Error&&error.message==='NETWORK_ERROR','search failure');}
    assert(JSON.stringify(store.get('weather'))===JSON.stringify(first),'search does not alter widget data');
    session.refresh('weather');await until(()=>store.get('weather').status==='stale');assert(store.get('weather').updatedAt===first.updatedAt,'original successful timestamp');
    await http.get(`${origin}/limited`,{maxBytes:100,timeoutMs:1000},cancel());session.refreshAfterResume();await until(()=>store.get('weather').errorCode==='RATE_LIMITED');
    await resources.settings.setWeatherLocation(null,cancel());await until(()=>store.get('weather').status==='unconfigured');assert(store.get('weather').data===null,'clear removes displayed data');
    assert(await resources.cache.read('weather.json',524288,cancel())===null,'clear removes disk cache');
    session.destroy();await session.drained;http.destroy();
    print(JSON.stringify({test:'real HTTP search/select/forecast/offline/429/clear through the local session',success:true}));
})().then(()=>loop.quit(),error=>{printerr(`${String(error)}\n${error instanceof Error?error.stack:''}`);exitCode=1;loop.quit();});
loop.run();System.exit(exitCode);
