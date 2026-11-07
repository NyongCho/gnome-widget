import GLib from 'gi://GLib';
import {SessionTransport,BUS_NAME} from '../dbus.js';
import {Cancellation,DataClient} from '../shared/dataClient.js';
import {ProviderStore} from '../shared/providerStore.js';
import {parseSettings,parseLocationSearchResults} from '../shared/validation.js';
import {summarizeCalendar,type CalendarSummary,type CalendarOrigin} from '../shared/calendarSummary.js';
import {GioLinuxFiles} from '../data/linux.js';
import {listNetworkInterfaces} from '../data/providers/network.js';
import {DataCancelled} from '../data/errors.js';
import type {PreferencesDataSession} from '../backend/contracts.js';
import type {WeatherLocation} from '../types.js';
export function createPreferencesDataSession(_extensionPath:string):PreferencesDataSession {
    return new RustPreferencesSession();
}
export class RustPreferencesSession implements PreferencesDataSession {
    private wire=new SessionTransport();private store=new ProviderStore();private client:DataClient;private dead=false;private connected=false;
    private listeners=new Set<(state:CalendarSummary,origin:CalendarOrigin)=>void>();private requests=new Set<Cancellation>();
    private instance=GLib.uuid_string_random();private revision=0;private generation=0;private key='';
    constructor(){this.client=new DataClient(this.wire,this.store,()=>this.publish(),state=>{
        if(state==='connecting'){this.instance=GLib.uuid_string_random();this.revision=0;this.generation=0;this.key='';}
        this.connected=state==='connected';this.publish();
    });}
    private async use<T>(caller:Cancellation,fn:(cancel:Cancellation)=>Promise<T>):Promise<T>{
        if(this.dead||caller.cancelled)throw new DataCancelled();const cancel=new Cancellation(),unlink=caller.onCancel(()=>cancel.cancel());this.requests.add(cancel);
        try{const result=await fn(cancel);if(this.dead||cancel.cancelled)throw new DataCancelled();return result;}finally{unlink();this.requests.delete(cancel);}
    }
    private call(method:string,args:readonly unknown[],cancel:Cancellation){return this.use(cancel,c=>this.wire.call(BUS_NAME,method,args,c));}
    async getSettings(cancel:Cancellation){return parseSettings(String((await this.call('GetSettings',[],cancel))[0]));}
    async setCalendarSecret(url:string,cancel:Cancellation){await this.call('SetCalendarSecret',[url],cancel);}
    async clearCalendarSecret(cancel:Cancellation){await this.call('ClearCalendarSecret',[],cancel);}
    async searchLocations(query:string,cancel:Cancellation){return parseLocationSearchResults(String((await this.call('SearchLocations',[query],cancel))[0]));}
    async setWeatherLocation(location:WeatherLocation|null,cancel:Cancellation){await this.call('SetWeatherLocation',[JSON.stringify(location)],cancel);}
    async setNetworkInterface(name:string,cancel:Cancellation){await this.call('SetNetworkInterface',[name],cancel);}
    listNetworkInterfaces(cancel:Cancellation){return this.use(cancel,c=>listNetworkInterfaces(new GioLinuxFiles(),c));}
    async refreshCalendar(cancel:Cancellation){await this.call('Refresh',['calendar'],cancel);}
    private publish():void{
        if(this.dead)return;const state=this.store.get('calendar'),context=state.data?{month:state.data.month,timeZone:state.data.timeZone,weekStart:state.data.weekStart}:null,key=JSON.stringify([state.sourceId,context]);if(key!==this.key){this.key=key;this.generation++;}
        const summary=summarizeCalendar(this.instance,++this.revision,this.generation,state,context);
        for(const listener of this.listeners)listener(summary,this.connected?'rust':'unavailable');
    }
    watchCalendar(changed:(state:CalendarSummary,origin:CalendarOrigin)=>void):()=>void{
        if(this.dead)return()=>{};this.listeners.add(changed);if(this.listeners.size===1)this.client.start(['calendar']);this.publish();
        let active=true;return()=>{if(!active)return;active=false;this.listeners.delete(changed);if(!this.listeners.size)this.client.stop();};
    }
    destroy():void{if(this.dead)return;this.dead=true;for(const request of this.requests)request.cancel();this.requests.clear();this.listeners.clear();this.client.stop();}
}
