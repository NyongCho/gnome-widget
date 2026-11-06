import {Cancellation} from '../shared/dataClient.js';
import {weatherLocation as validateLocation} from '../../generated/validators.js';
import type {Settings,WeatherLocation} from '../types.js';
import {ConfigStore,CALENDAR_CACHE_FILES,WEATHER_CACHE_FILE} from './config.js';
import type {PrivateFiles} from './contracts.js';
import type {SecretStore} from './contracts.js';
import {DataFailure} from './errors.js';
export function validateCalendarUrl(url:string):void {
    if(new TextEncoder().encode(url).length>8192||/[\x00-\x20\x7f]/.test(url)||!/^https:\/\/calendar\.google\.com(?::443)?\/calendar\/ical\/[^/?#]+\/(?:private-[^/?#]*|public)\/basic\.ics$/.test(url))throw new DataFailure('INVALID_DATA');
}
export class DataSettingsService {
    constructor(private config:ConfigStore,private secrets:SecretStore,private cache:PrivateFiles,private uuid:()=>string){}
    async getSettings(cancel:Cancellation):Promise<Settings>{const c=await this.config.read(cancel);return{calendarEnabled:c.calendar.enabled,calendarSecretDeletionPending:c.calendar.deletionPending,weatherLocation:c.weather.location,networkInterface:c.networkInterface};}
    private async pending():Promise<void>{
        // Uncertain remote operations cannot be rolled back by cancelling our caller.
        // This flag is monotonic except for a successful explicit disconnect.
        await this.config.mutate(async tx=>{if(!tx.current.calendar.deletionPending)await tx.replace({...tx.current,calendar:{...tx.current.calendar,deletionPending:true}});},new Cancellation());
    }
    async setCalendarSecret(url:string,cancel:Cancellation):Promise<void>{
        validateCalendarUrl(url);let uncertain=false;
        try{await this.config.mutate(async tx=>{
            const source=this.uuid(),previous=tx.current.calendar.sourceId;
            try{await this.secrets.save(source,url,cancel);}catch(error){uncertain=true;throw error;}
            try{await tx.replace({...tx.current,calendar:{...tx.current.calendar,enabled:true,sourceId:source}});}
            catch(error){
                // A cancelled atomic rename may already have committed. Never delete
                // the secret referenced by the persisted configuration.
                try{if((await this.config.read(new Cancellation())).calendar.sourceId!==source)await this.secrets.remove(source,new Cancellation());}
                catch{uncertain=true;}throw error;
            }
            let cacheFailed=false;
            for(const name of CALENDAR_CACHE_FILES){try{await this.cache.remove(name,cancel);}catch{cacheFailed=true;}}
            if(previous&&previous!==source){try{await this.secrets.remove(previous,cancel);}catch{uncertain=true;await tx.replace({...tx.current,calendar:{...tx.current.calendar,deletionPending:true}});}}
            if(cacheFailed)throw new DataFailure('SERVICE_UNAVAILABLE');
        },cancel);}catch(error){if(uncertain)await this.pending().catch(()=>{});throw error instanceof DataFailure?error:new DataFailure('SERVICE_UNAVAILABLE');}
    }
    async clearCalendarSecret(cancel:Cancellation):Promise<void>{
        try{await this.config.mutate(async tx=>{
            await tx.replace({...tx.current,calendar:{enabled:false,sourceId:null,deletionPending:true}});
            for(const name of CALENDAR_CACHE_FILES)await this.cache.remove(name,cancel);
            await this.secrets.clearAll(cancel);
            await tx.replace({...tx.current,calendar:{...tx.current.calendar,deletionPending:false}});
        },cancel);}catch{throw new DataFailure('SECRET_DELETION_FAILED');}
    }
    async setWeatherLocation(location:WeatherLocation|null,cancel:Cancellation):Promise<void>{
        if(!validateLocation(location))throw new DataFailure('INVALID_DATA');
        await this.config.mutate(async tx=>{
            await tx.replace({...tx.current,weather:{sourceId:location?this.uuid():null,location}});
            await this.cache.remove(WEATHER_CACHE_FILE,cancel);
        },cancel);
    }
    async setNetworkInterface(name:string,cancel:Cancellation):Promise<void>{
        if(!/^[A-Za-z0-9_.:-]{1,15}$/.test(name))throw new DataFailure('INVALID_DATA');
        await this.config.mutate(async tx=>{await tx.replace({...tx.current,networkInterface:name});},cancel);
    }
}
