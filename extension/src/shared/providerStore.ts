import type {ProviderName,ProviderMap,Snapshot} from '../types.js';
import {ValidationError} from './validation.js';
export const PROVIDERS: readonly ProviderName[] = ['calendar','weather','system','network','media'];
export class ProviderStore {
    private states:ProviderMap = {
        calendar:{status:'unconfigured',sourceId:null,updatedAt:null,data:null,errorCode:null},
        weather:{status:'unconfigured',sourceId:null,updatedAt:null,data:null,errorCode:null},
        system:{status:'unavailable',sourceId:null,updatedAt:null,data:null,errorCode:'SERVICE_UNAVAILABLE'},
        network:{status:'unavailable',sourceId:null,updatedAt:null,data:null,errorCode:'SERVICE_UNAVAILABLE'},
        media:{status:'unavailable',sourceId:null,updatedAt:null,data:null,errorCode:'SERVICE_UNAVAILABLE'},
    };
    private revisions = new Map<ProviderName,number>();
    acceptSnapshot(snapshot:Snapshot):void {
        for (const name of PROVIDERS) this.applyChange(name,snapshot.revisions[name],snapshot[name]);
    }
    applyChange<K extends ProviderName>(name:K,revision:number,state:ProviderMap[K]):boolean {
        if (!PROVIDERS.includes(name) || !Number.isInteger(revision) || revision<0 || revision>0xffffffff) throw new ValidationError();
        if (revision <= (this.revisions.get(name) ?? -1)) return false;
        this.states[name]=state; this.revisions.set(name,revision);
        return true;
    }
    markRefreshing<K extends ProviderName>(name:K):void {
        const state=this.states[name];
        if(state.status!=='unconfigured')this.states[name]={...state,status:'loading',errorCode:null} as ProviderMap[K];
    }
    // Retain values for the disconnected UI; revision ownership never crosses owners.
    resetOwner():void { this.revisions.clear(); }
    get<K extends ProviderName>(name:K):ProviderMap[K] { return this.states[name]; }
}
