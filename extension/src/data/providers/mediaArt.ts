import {Cancellation} from '../../shared/dataClient.js';
import type {HttpClient} from '../contracts.js';
import type {SessionClock} from '../localSession.js';
import {DataCancelled,DataFailure} from '../errors.js';
export const ART_MAX_BYTES=8*1024*1024;
export interface ArtworkStore {
    local(uri:string,cancel:Cancellation):Promise<string|null>;
    cached(uri:string,cancel:Cancellation):Promise<string|null>;
    put(uri:string,bytes:Uint8Array,cancel:Cancellation):Promise<string|null>;
}
/** Conservative syntax gate; the Gio store also parses and validates the local target. */
export function artworkKind(uri:string):'remote'|'local'|null {
    if(!uri||uri.length>4096||/[\s\u0000-\u001f\u007f\\]/u.test(uri))return null;
    if(/^file:\/\/\/[^?#]+$/.test(uri))return'local';
    const match=/^https:\/\/([^/?#]+)(?:[/?][^#]*)?$/i.exec(uri);
    if(!match||! /^(?:[a-z\d.-]+|\[[a-f\d:]+\])(?::\d{1,5})?$/i.test(match[1]!))return null;
    return'remote';
}
export class ArtworkLoader {
    private failures=new Map<string,number>();
    private active=new Map<string,{cancel:Cancellation;promise:Promise<string|null>;users:number}>();
    constructor(private http:HttpClient,private store:ArtworkStore,private clock:SessionClock){}
    private delay(cancel:Cancellation):Promise<void>{return new Promise((resolve,reject)=>{
        let unlink=()=>{};const stop=this.clock.schedule(2000,()=>{unlink();resolve();});
        unlink=cancel.onCancel(()=>{stop();reject(new DataCancelled());});
    });}
    async loadArtwork(uri:string,cancel:Cancellation):Promise<string|null>{
        if(cancel.cancelled)throw new DataCancelled();
        if(artworkKind(uri)!=='remote')return this.loadOne(uri,cancel);
        let entry=this.active.get(uri);
        if(!entry){const shared=new Cancellation();entry={cancel:shared,promise:this.loadOne(uri,shared),users:0};this.active.set(uri,entry);}
        const request=entry;request.users++;
        return new Promise((resolve,reject)=>{
            let finished=false,unlink=()=>{};
            const release=()=>{if(finished)return false;finished=true;unlink();request.users--;
                if(!request.users){if(this.active.get(uri)===request)this.active.delete(uri);request.cancel.cancel();}return true;};
            unlink=cancel.onCancel(()=>{if(release())reject(new DataCancelled());});
            request.promise.then(value=>{if(release())resolve(value);},error=>{if(release())reject(error);});
        });
    }
    private async fetch(uri:string,cancel:Cancellation):Promise<Uint8Array>{
        const io=new Cancellation();let stop=()=>{},unlink=()=>{};
        const deadline=new Promise<never>((_resolve,reject)=>{
            stop=this.clock.schedule(5000,()=>{io.cancel();reject(new DataFailure('NETWORK_ERROR'));});
            unlink=cancel.onCancel(()=>{io.cancel();reject(new DataCancelled());});
        });
        try{return await Promise.race([this.http.get(uri,{maxBytes:ART_MAX_BYTES,timeoutMs:5000},io),deadline]);}
        finally{stop();unlink();io.cancel();}
    }
    private async loadOne(uri:string,cancel:Cancellation):Promise<string|null>{
        if(cancel.cancelled)throw new DataCancelled();const kind=artworkKind(uri);if(!kind)return null;
        try{
            if(kind==='local')return await this.store.local(uri,cancel);
            const cached=await this.store.cached(uri,cancel);if(cancel.cancelled)throw new DataCancelled();if(cached)return cached;
            const now=this.clock.monotonic();for(const[key,at]of this.failures)if(now-at>=60000)this.failures.delete(key);
            if(this.failures.has(uri))return null;
            let bytes:Uint8Array;
            try{bytes=await this.fetch(uri,cancel);}
            catch(error){if(cancel.cancelled)throw new DataCancelled();if(!(error instanceof DataFailure)||error.code!=='NETWORK_ERROR')throw error;
                await this.delay(cancel);bytes=await this.fetch(uri,cancel);}
            if(cancel.cancelled)throw new DataCancelled();if(!bytes.length||bytes.length>ART_MAX_BYTES)throw new DataFailure('INVALID_DATA');
            return await this.store.put(uri,bytes,cancel);
        }catch(error){
            if(cancel.cancelled||error instanceof DataCancelled)throw new DataCancelled();
            if(kind==='remote'){if(this.failures.size>=64)this.failures.delete(this.failures.keys().next().value!);this.failures.set(uri,this.clock.monotonic());}
            return null;
        }
    }
}
