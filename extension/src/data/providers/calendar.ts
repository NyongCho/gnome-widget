import {Cancellation} from '../../shared/dataClient.js';
import {parseProviderState} from '../../shared/validation.js';
import type {CalendarData,ProviderMap} from '../../types.js';
import {INPUT_LIMIT,REPLY_LIMIT,ProtocolFailure,type CalendarJob} from '../../calendar/protocol.js';
import type {ConfigStore,DataConfig} from '../config.js';
import type {HttpClient,PrivateFiles,SecretStore} from '../contracts.js';
import {DataCancelled,DataFailure} from '../errors.js';
import type {ProviderContext,ProviderDriver} from '../scheduler.js';
import {checkedState,sameContext} from '../state.js';
import {validateCalendarUrl} from '../settings.js';
export interface CalendarComputer {run(job:CalendarJob,cancel:Cancellation):Promise<CalendarData>;dispose():Promise<void>}
interface Dependencies {http:HttpClient;secrets:SecretStore;files:PrivateFiles;config:ConfigStore;worker:CalendarComputer;uuid():string;digest(bytes:Uint8Array):string;writeCache?:boolean}
interface RawCache {sourceId:string;updatedAt:string;bytes:Uint8Array}
const encode=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value));
const failure=(error:unknown)=>error instanceof DataFailure?error:new DataFailure(error instanceof ProtocolFailure?error.code:'SERVICE_UNAVAILABLE');
function sourceMatches(config:DataConfig,source:string):boolean{return config.calendar.enabled&&config.calendar.sourceId===source;}
function check(cancel:Cancellation):void{if(cancel.cancelled)throw new DataCancelled();}
export class CalendarProvider implements ProviderDriver<'calendar'> {
    private generation=0;private dead=false;private active=new Set<Cancellation>();
    private raw:RawCache|null=null;private good:ProviderMap['calendar']|null=null;
    constructor(private deps:Dependencies){}
    async collect(context:ProviderContext):Promise<ProviderMap['calendar']>{
        if(this.dead)throw new DataCancelled();const cancel=new Cancellation(),unlink=context.cancel.onCancel(()=>cancel.cancel());this.active.add(cancel);
        try{return await this.collectOne({...context,cancel});}finally{unlink();this.active.delete(cancel);}
    }
    private async current(source:string,cancel:Cancellation):Promise<void>{check(cancel);if(!sourceMatches(await this.deps.config.read(cancel),source))throw new DataCancelled();check(cancel);}
    private async expand(raw:RawCache,context:ProviderContext,error:DataFailure|null):Promise<ProviderMap['calendar']>{
        check(context.cancel);const header={version:1 as const,jobId:this.deps.uuid(),sourceId:raw.sourceId,generation:this.generation=(this.generation+1)>>>0,context:{...context.calendarContext},now:context.now};
        const data=await this.deps.worker.run({header,ics:raw.bytes},context.cancel);check(context.cancel);
        return checkedState('calendar',{status:error?'stale':'ok',sourceId:raw.sourceId,updatedAt:raw.updatedAt,data,errorCode:error?.code??null},raw.sourceId,context.calendarContext);
    }
    private async readRaw(source:string,cancel:Cancellation):Promise<RawCache|null>{
        if(this.raw?.sourceId===source)return this.raw;
        try{
            const metadata=await this.deps.files.read('calendar-raw.json',16384,cancel);if(!metadata)return null;
            const value:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(metadata));if(!value||typeof value!=='object'||Array.isArray(value))return null;
            const meta=value as Record<string,unknown>;
            if(Object.keys(meta).sort().join(',')!=='schemaVersion,sha256,sourceId,updatedAt'||meta.schemaVersion!==1||meta.sourceId!==source||typeof meta.sha256!=='string'||!/^[a-f0-9]{64}$/.test(meta.sha256)||typeof meta.updatedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(meta.updatedAt)||!Number.isFinite(Date.parse(meta.updatedAt)))return null;
            const bytes=await this.deps.files.read('calendar-raw.ics',INPUT_LIMIT,cancel);check(cancel);
            if(!bytes||bytes.length>INPUT_LIMIT||this.deps.digest(bytes)!==meta.sha256)return null;
            return{sourceId:source,updatedAt:meta.updatedAt,bytes};
        }catch(error){if(cancel.cancelled||error instanceof DataCancelled)throw new DataCancelled();return null;}
    }
    private async readGood(source:string,context:ProviderContext):Promise<ProviderMap['calendar']|null>{
        if(this.good?.sourceId===source&&sameContext('calendar',this.good,context.calendarContext))return this.good;
        try{const bytes=await this.deps.files.read('calendar-data.json',REPLY_LIMIT+1024,context.cancel);if(!bytes)return null;
            const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as {schemaVersion?:unknown;state?:unknown};
            if(value.schemaVersion!==1||Object.keys(value).sort().join(',')!=='schemaVersion,state')return null;
            const state=parseProviderState('calendar',JSON.stringify(value.state));
            return state.status==='ok'&&state.sourceId===source&&state.data&&sameContext('calendar',state,context.calendarContext)?state:null;
        }catch(error){if(context.cancel.cancelled||error instanceof DataCancelled)throw new DataCancelled();return null;}
    }
    private async commit(raw:RawCache,state:ProviderMap['calendar'],context:ProviderContext):Promise<void>{
        const cancel=context.cancel;
        if(this.deps.writeCache!==false){
            const metadata=encode({schemaVersion:1,sourceId:raw.sourceId,updatedAt:raw.updatedAt,sha256:this.deps.digest(raw.bytes)}),data=encode({schemaVersion:1,state});
            await this.deps.config.mutate(async tx=>{
                // Re-read the config revision under the mutation lease. An unrelated
                // weather/network revision may advance; the calendar source UUID
                // (changed on every URL replacement) is the calendar identity fence.
                if(!sourceMatches(tx.current,raw.sourceId))throw new DataCancelled();check(cancel);
                await this.deps.files.replace('calendar-raw.ics',raw.bytes,cancel);check(cancel);
                await this.deps.files.replace('calendar-raw.json',metadata,cancel);check(cancel);
                await this.deps.files.replace('calendar-data.json',data,cancel);check(cancel);
            },cancel);
        }
        await this.current(raw.sourceId,cancel);this.raw=raw;this.good=state;
    }
    private async collectOne(context:ProviderContext):Promise<ProviderMap['calendar']>{
        const source=context.config.calendar.enabled?context.config.calendar.sourceId:null,cancel=context.cancel;
        if(!source){this.raw=null;this.good=null;return{status:'unconfigured',sourceId:null,updatedAt:null,data:null,errorCode:null};}
        await this.current(source,cancel);let error:DataFailure;
        try{
            const url=await this.deps.secrets.lookup(source,cancel);check(cancel);if(!url)throw new DataFailure('AUTH_ERROR');
            try{validateCalendarUrl(url);}catch{throw new DataFailure('AUTH_ERROR');}
            const bytes=await this.deps.http.get(url,{maxBytes:INPUT_LIMIT,timeoutMs:15000},cancel);check(cancel);
            await this.current(source,cancel);if(bytes.length>INPUT_LIMIT)throw new DataFailure('PAYLOAD_TOO_LARGE');
            const raw={sourceId:source,updatedAt:context.now,bytes},state=await this.expand(raw,context,null);
            await this.commit(raw,state,context);return state;
        }catch(caught){if(cancel.cancelled||caught instanceof DataCancelled)throw new DataCancelled();error=failure(caught);}
        await this.current(source,cancel);
        const raw=await this.readRaw(source,cancel);
        if(raw){try{const stale=await this.expand(raw,context,error);await this.current(source,cancel);return stale;}
            catch(caught){if(cancel.cancelled||caught instanceof DataCancelled)throw new DataCancelled();error=failure(caught);}}
        const previous=await this.readGood(source,context);await this.current(source,cancel);
        if(previous)return{...previous,status:'stale',errorCode:error.code};throw error;
    }
    async destroy():Promise<void>{if(this.dead)return;this.dead=true;for(const cancel of this.active)cancel.cancel();this.raw=null;this.good=null;await this.deps.worker.dispose();}
}
