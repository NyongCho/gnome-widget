import {Cancellation} from '../../shared/dataClient.js';
import type {ProviderMap} from '../../types.js';
import type {SessionClock} from '../localSession.js';
import type {SignalProviderDriver} from '../scheduler.js';
export interface PlayerSnapshot {identity:string;status:string;title:string;artist:string;artUri:string|null;trackId:string}
export type MprisEvent={kind:'owner';name:string;oldOwner:string;newOwner:string}|{kind:'properties';owner:string};
export interface MprisBus {
    listNames(cancel:Cancellation):Promise<string[]>;
    getOwner(name:string,cancel:Cancellation):Promise<string>;
    read(owner:string,cancel:Cancellation):Promise<PlayerSnapshot>;
    watch(changed:(event:MprisEvent)=>void):()=>void;
}
interface Entry {name:string;owner:string;value:PlayerSnapshot|null;cancel:Cancellation;reading:boolean;pending:boolean}
/** Signal-driven: no periodic player enumeration or property polling. */
export class MediaProvider implements SignalProviderDriver<'media'> {
    private stop:(()=>void)|null=null;
    constructor(private bus:MprisBus,private art:{loadArtwork(uri:string,cancel:Cancellation):Promise<string|null>},private clock:SessionClock){}
    start(publish:(state:ProviderMap['media'])=>void,cancel:Cancellation):void {
        this.stop?.();if(cancel.cancelled)return;
        const lifetime=new Cancellation(),entries=new Map<string,Entry>();let discovery:Cancellation|null=null,artCancel:Cancellation|null=null,selectedKey='',dead=false;
        let generation=0,discoveryRunning=false,discoveryPending=false;
        const emit=()=>{
            if(dead)return;
            const entry=[...entries.values()].filter(e=>e.value?.status==='Playing').sort((a,b)=>a.name.localeCompare(b.name))[0];
            const value=entry?.value;
            const key=value?JSON.stringify([entry!.owner,value]):'';
            if(key===selectedKey)return;selectedKey=key;artCancel?.cancel();artCancel=null;const current=++generation;
            if(!value){publish({status:'unavailable',sourceId:'mpris',updatedAt:null,data:null,errorCode:'NO_PLAYER'});return;}
            const state:ProviderMap['media']={status:'ok',sourceId:'mpris',updatedAt:this.clock.now(),errorCode:null,data:{player:value.identity||entry!.name,status:'playing',title:value.title,artist:value.artist,artUri:null}};
            publish(state);
            if(value.artUri){const request=new Cancellation();artCancel=request;
                void this.art.loadArtwork(value.artUri,request).then(async uri=>{
                    if(!uri||dead||request.cancelled||generation!==current)return;
                    try{
                        // Re-query because a player's PropertiesChanged signal can lag its state.
                        const owner=await this.bus.getOwner(entry!.name,request);
                        if(dead||request.cancelled||generation!==current)return;
                        if(owner!==entry!.owner){entry!.cancel.cancel();entries.delete(entry!.name);emit();discover();return;}
                        const latest=await this.bus.read(owner,request);
                        if(dead||request.cancelled||generation!==current||entries.get(entry!.name)!==entry)return;
                        if(JSON.stringify([owner,latest])!==key){entry!.value=latest;emit();return;}
                        publish({...state,data:{...state.data!,artUri:uri}});
                    }catch{/* Failed validation keeps the metadata without obsolete artwork. */}
                },()=>{/* Metadata remains usable when artwork fails. */});}
        };
        const read=async(entry:Entry)=>{
            if(dead||entry.cancel.cancelled)return;if(entry.reading){entry.pending=true;return;}entry.reading=true;
            try{const value=await this.bus.read(entry.owner,entry.cancel);if(!dead&&!entry.cancel.cancelled&&entries.get(entry.name)===entry){entry.value=value;emit();}}
            catch{if(!dead&&!entry.cancel.cancelled&&entries.get(entry.name)===entry){entry.value=null;emit();}}
            finally{entry.reading=false;if(entry.pending&&!dead&&!entry.cancel.cancelled){entry.pending=false;void read(entry);}}
        };
        const discover=()=>{
            if(dead)return;if(discoveryRunning){discoveryPending=true;discovery?.cancel();return;}
            discoveryRunning=true;discoveryPending=false;const request=new Cancellation();discovery=request;
            void (async()=>{
                const names=(await this.bus.listNames(request)).filter(n=>n.startsWith('org.mpris.MediaPlayer2.')&&n.length<=255).sort().slice(0,32);
                if(request.cancelled||dead)return;
                for(const[name,entry]of entries)if(!names.includes(name)){entry.cancel.cancel();entries.delete(name);}emit();
                // At most four discovery calls in flight; every adapter call has a 2s deadline.
                let index=0;await Promise.all(Array.from({length:Math.min(4,names.length)},async()=>{
                    while(index<names.length&&!request.cancelled&&!dead){const name=names[index++]!;
                        try{const owner=await this.bus.getOwner(name,request);if(request.cancelled||dead)return;
                            let entry=entries.get(name);if(entry?.owner!==owner){entry?.cancel.cancel();entry={name,owner,value:null,cancel:new Cancellation(),reading:false,pending:false};entries.set(name,entry);}
                            await read(entry);
                        }catch{/* A player may disappear between enumeration and GetNameOwner. */}
                    }
                }));
                if(!dead&&!request.cancelled&&selectedKey==='')publish({status:'unavailable',sourceId:'mpris',updatedAt:null,data:null,errorCode:'NO_PLAYER'});
            })().catch(()=>{if(!dead&&!request.cancelled)publish({status:'unavailable',sourceId:'mpris',updatedAt:null,data:null,errorCode:'SERVICE_UNAVAILABLE'});})
                .finally(()=>{discoveryRunning=false;if(discoveryPending&&!dead)discover();});
        };
        const unwatch=this.bus.watch(event=>{
            if(dead)return;
            if(event.kind==='properties'){for(const entry of entries.values())if(entry.owner===event.owner)void read(entry);}
            else if(event.name.startsWith('org.mpris.MediaPlayer2.')){const entry=entries.get(event.name);if(entry&&entry.owner!==event.newOwner){entry.cancel.cancel();entries.delete(event.name);emit();}discover();}
        });
        const stop=()=>{if(dead)return;dead=true;discovery?.cancel();artCancel?.cancel();for(const entry of entries.values())entry.cancel.cancel();entries.clear();unwatch();unlink();if(this.stop===stop)this.stop=null;};
        let unlink=()=>{};this.stop=stop;unlink=cancel.onCancel(()=>lifetime.cancel());lifetime.onCancel(stop);discover();
    }
    destroy():void {this.stop?.();}
}
