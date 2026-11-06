import GLib from 'gi://GLib';
import {PublicPreferencesSession} from '../../src/prefs/dataSession.js';
import {createPublicDataServices} from '../../src/data/runtime.js';
import {DataSettingsService} from '../../src/data/settings.js';
import {Cancellation} from '../../src/shared/dataClient.js';
import {DataFailure,DataCancelled} from '../../src/data/errors.js';
import type {PreferencesDataSession} from '../../src/backend/contracts.js';
import type {Settings,WeatherLocation} from '../../src/types.js';
const secrets=new Map<string,string>();let status='unavailable';
export function publicPreferencesFixture(path:string,hooks:{current:Settings;location:WeatherLocation;search(query:string,complete:()=>void):void;connected():void;cleared():void;watch(delta:number):void}){
    const services=createPublicDataServices();let offset=0;
    const clock={...services.clock,monotonic:()=>services.clock.monotonic()+offset};
    const secret={async lookup(source:string){return secrets.get(source)??null;},async save(source:string,url:string){secrets.set(source,url);},async remove(source:string){secrets.delete(source);},async clearAll(){secrets.clear();}};
    services.http.get=async(url,_limits,cancel)=>{
        if(url.startsWith('https://geocoding-api.open-meteo.com/')){
            const query=decodeURIComponent(/[?&]name=([^&]*)/.exec(url)?.[1]??'');
            if(query==='Fail')throw new DataFailure('NETWORK_ERROR');
            await new Promise<void>((resolve,reject)=>{let unlink=()=>{};unlink=cancel.onCancel(()=>reject(new DataCancelled()));hooks.search(query,()=>{unlink();resolve();});});
            return new TextEncoder().encode(JSON.stringify({results:[{id:1,name:hooks.location.label,latitude:hooks.location.latitude,longitude:hooks.location.longitude,timezone:hooks.location.timeZone}]}));
        }
        if(!url.startsWith('https://calendar.google.com/'))throw new DataFailure('NETWORK_ERROR');
        if(status==='stale')throw new DataFailure('NETWORK_ERROR');
        return new TextEncoder().encode(status==='ok'?'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n':'invalid fixture');
    };
    const rawSettings=new DataSettingsService(services.config,secret,services.cache,GLib.uuid_string_random);
    const raw=new PublicPreferencesSession(path,{...services,secrets:secret,settings:rawSettings,clock});
    const update=async()=>Object.assign(hooks.current,await raw.getSettings(new Cancellation()));
    const session:PreferencesDataSession={
        getSettings:raw.getSettings.bind(raw),
        async setCalendarSecret(url,c){hooks.connected();if(url!=='https://calendar.google.com/calendar/ical/test/public/basic.ics')throw new DataFailure('INVALID_DATA');await raw.setCalendarSecret(url,c);await update();},
        async clearCalendarSecret(c){hooks.cleared();await raw.clearCalendarSecret(c);await update();},
        async searchLocations(query,c){offset+=1001;const locations=await raw.searchLocations(query,c);return locations.map(location=>({...location,id:hooks.location.id}));},
        async setWeatherLocation(location,c){await raw.setWeatherLocation(location,c);await update();},
        async setNetworkInterface(name,c){await raw.setNetworkInterface(name,c);await update();},
        listNetworkInterfaces:raw.listNetworkInterfaces.bind(raw),
        refreshCalendar:raw.refreshCalendar.bind(raw),
        watchCalendar(changed){hooks.watch(1);const stop=raw.watchCalendar(changed);let alive=true;return()=>{if(alive){alive=false;hooks.watch(-1);stop();}};},
        destroy:raw.destroy.bind(raw),
    };
    return{session,async setStatus(value:string){status=value;offset+=6000;await raw.refreshCalendar(new Cancellation());}};
}
