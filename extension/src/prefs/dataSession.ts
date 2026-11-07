import GLib from 'gi://GLib';
import type {PreferencesDataSession} from '../backend/contracts.js';
import {createPublicDataServices} from '../data/runtime.js';
import {Cancellation} from '../shared/dataClient.js';
import {DataCancelled,DataFailure} from '../data/errors.js';
import type {WeatherLocation} from '../types.js';
import {CalendarStatusClient,type StatusTransport} from '../calendar/statusClient.js';
import {GioStatusTransport} from '../calendar/statusTransport.js';
import {summarizeCalendar,type CalendarSummary,type CalendarOrigin} from '../shared/calendarSummary.js';
import {CalendarPreview,type PublicDataServices} from './calendarPreview.js';
type Listener=(state:CalendarSummary,origin:CalendarOrigin)=>void;
export class PublicPreferencesSession implements PreferencesDataSession {
    private dead=false;private requests=new Set<Cancellation>();private listeners=new Set<Listener>();
    private client:CalendarStatusClient|null=null;private preview:CalendarPreview|null=null;private owner:string|null=null;
    private latest:{state:CalendarSummary;origin:CalendarOrigin}|null=null;private attachment=0;
    constructor(private extensionPath:string,private services:PublicDataServices=createPublicDataServices(),private transport:StatusTransport=new GioStatusTransport()){}
    private async use<T>(caller:Cancellation,fn:(cancel:Cancellation)=>Promise<T>):Promise<T>{
        if(this.dead||caller.cancelled)throw new DataCancelled();const cancel=new Cancellation(),unlink=caller.onCancel(()=>cancel.cancel());this.requests.add(cancel);
        try{const result=await fn(cancel);if(this.dead||cancel.cancelled)throw new DataCancelled();return result;}finally{unlink();this.requests.delete(cancel);}
    }
    getSettings(cancel:Cancellation){return this.use(cancel,c=>this.services.settings.getSettings(c));}
    setCalendarSecret(url:string,cancel:Cancellation){return this.use(cancel,c=>this.services.settings.setCalendarSecret(url,c));}
    clearCalendarSecret(cancel:Cancellation){return this.use(cancel,c=>this.services.settings.clearCalendarSecret(c));}
    searchLocations(query:string,cancel:Cancellation){return this.use(cancel,c=>this.services.locations.searchLocations(query,c));}
    setWeatherLocation(location:WeatherLocation|null,cancel:Cancellation){return this.use(cancel,c=>this.services.settings.setWeatherLocation(location,c));}
    setNetworkInterface(name:string,cancel:Cancellation){return this.use(cancel,c=>this.services.settings.setNetworkInterface(name,c));}
    listNetworkInterfaces(cancel:Cancellation){return this.use(cancel,c=>this.services.listNetworkInterfaces(c));}
    private publish(state:CalendarSummary,origin:CalendarOrigin):void{if(this.dead)return;this.latest={state,origin};for(const listener of this.listeners)listener(state,origin);}
    private unavailable():void{this.publish(summarizeCalendar(GLib.uuid_string_random(),0,0,{status:'unavailable',sourceId:null,updatedAt:null,errorCode:'SERVICE_UNAVAILABLE',data:null},null),'unavailable');}
    private stopPreview():void{const preview=this.preview;this.preview=null;if(preview)void preview.destroy().catch(()=>{});}
    watchCalendar(changed:Listener):()=>void{
        if(this.dead)return()=>{};this.listeners.add(changed);if(this.latest)changed(this.latest.state,this.latest.origin);
        if(!this.client){this.client=new CalendarStatusClient(this.transport,state=>this.publish(state,'shell'),owner=>{
            const attachment=++this.attachment;this.owner=owner;this.stopPreview();this.unavailable();
            if(!owner&&!this.dead&&this.listeners.size){this.preview=new CalendarPreview(this.extensionPath,this.services,state=>{if(!this.dead&&!this.owner&&attachment===this.attachment)this.publish(state,'preview');});}
        },()=>this.unavailable());this.client.start();}
        let active=true;return()=>{if(!active)return;active=false;this.listeners.delete(changed);if(!this.listeners.size){this.attachment++;this.client?.destroy();this.client=null;this.stopPreview();this.latest=null;this.owner=null;}};
    }
    refreshCalendar(cancel:Cancellation):Promise<void>{return this.use(cancel,c=>{if(this.owner&&this.client)return this.client.refresh(c);if(this.preview)return this.preview.refresh(c);throw new DataFailure('SERVICE_UNAVAILABLE');});}
    destroy():void{if(this.dead)return;this.dead=true;this.attachment++;for(const request of this.requests)request.cancel();this.requests.clear();this.listeners.clear();this.client?.destroy();this.client=null;this.stopPreview();this.services.destroy();}
}
export function createPreferencesDataSession(extensionPath:string):PreferencesDataSession {
    return new PublicPreferencesSession(extensionPath);
}
