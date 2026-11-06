import {dataConfig as validate} from '../../generated/validators.js';
import {Cancellation} from '../shared/dataClient.js';
import type {WeatherLocation} from '../types.js';
import type {PrivateFiles} from './contracts.js';
import {DataFailure,DataCancelled} from './errors.js';
export interface DataConfig {
    schemaVersion:1;revision:string;
    calendar:{sourceId:string|null;enabled:boolean;deletionPending:boolean};
    weather:{sourceId:string|null;location:WeatherLocation|null};networkInterface:string;
}
export interface ConfigTransaction {readonly current:DataConfig;replace(next:DataConfig):Promise<DataConfig>}
interface ConfigDependencies {
    files:PrivateFiles;uuid:()=>string;
    acquire(cancel:Cancellation):Promise<{release():void}>;
    watch(changed:()=>void):()=>void;
}
export const CALENDAR_CACHE_FILES=['calendar-raw.ics','calendar-raw.json','calendar-data.json'] as const;
export const WEATHER_CACHE_FILE='weather.json';
function clone(value:DataConfig):DataConfig{return JSON.parse(JSON.stringify(value)) as DataConfig;}
export function defaultConfig():DataConfig{return{schemaVersion:1,revision:'00000000-0000-0000-0000-000000000000',calendar:{sourceId:null,enabled:false,deletionPending:false},weather:{sourceId:null,location:null},networkInterface:'auto'};}
function checked(value:unknown):DataConfig {
    if(!validate(value))throw new DataFailure('INVALID_DATA');
    const data=value as DataConfig;
    if(data.calendar.enabled&&!data.calendar.sourceId||Boolean(data.weather.sourceId)!==Boolean(data.weather.location))throw new DataFailure('INVALID_DATA');
    return clone(data);
}
export class ConfigStore {
    constructor(private dependencies:ConfigDependencies){}
    async read(cancel:Cancellation):Promise<DataConfig> {
        if(cancel.cancelled)throw new DataCancelled();
        const bytes=await this.dependencies.files.read('settings.json',65536,cancel);
        if(bytes===null)return defaultConfig();
        if(bytes.length>65536)throw new DataFailure('PAYLOAD_TOO_LARGE');
        try{return checked(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));}
        catch(error){throw error instanceof DataFailure?error:new DataFailure('INVALID_DATA');}
    }
    watch(changed:(config:DataConfig)=>void):()=>void {
        let cancel=new Cancellation(),alive=true;
        const unwatch=this.dependencies.watch(()=>{
            cancel.cancel();cancel=new Cancellation();const current=cancel;
            void this.read(current).then(config=>{if(alive&&!current.cancelled)changed(config);}).catch(()=>{});
        });
        return()=>{alive=false;cancel.cancel();unwatch();};
    }
    async mutate<T>(fn:(tx:ConfigTransaction)=>Promise<T>,cancel:Cancellation):Promise<T> {
        if(cancel.cancelled)throw new DataCancelled();
        const lease=await this.dependencies.acquire(cancel);let active=true;
        try{
            let current=await this.read(cancel);
            const assert=()=>{if(!active)throw new Error('TRANSACTION_CLOSED');if(cancel.cancelled)throw new DataCancelled();};
            const tx:ConfigTransaction={get current(){assert();return clone(current);},replace:async next=>{
                assert();const data=checked({...next,revision:this.dependencies.uuid()});
                const bytes=new TextEncoder().encode(JSON.stringify(data));if(bytes.length>65536)throw new DataFailure('PAYLOAD_TOO_LARGE');
                await this.dependencies.files.replace('settings.json',bytes,cancel);assert();current=data;return clone(data);
            }};
            return await fn(tx);
        }finally{active=false;lease.release();}
    }
}
