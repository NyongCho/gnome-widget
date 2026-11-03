import type {ProviderName,CalendarContext} from '../types.js';
import {ProviderStore,PROVIDERS} from './providerStore.js';
import {parseSnapshot,parseProviderState} from './validation.js';
export type ChangeHandler=(name:string,revision:number,payload:string)=>void;
export type ConnectionState='connecting'|'connected'|'disconnected'|'invalid-data'|'unavailable';
export class Cancellation {
    cancelled=false;
    private listeners=new Set<()=>void>();
    onCancel(callback:()=>void):()=>void {if(this.cancelled) callback(); else this.listeners.add(callback);return()=>{this.listeners.delete(callback);};}
    cancel():void {this.cancelled=true;for(const callback of this.listeners) callback();this.listeners.clear();}
}
export interface Transport {
    schedule(delay:number,callback:()=>void):()=>void;
    watchOwner(callback:(owner:string|null)=>void):()=>void;
    watchChanges(owner:string,callback:ChangeHandler):()=>void;
    call(owner:string,method:string,args:readonly unknown[],cancel:Cancellation|null):Promise<readonly unknown[]>;
}
export class DataClient {
    private desiredContext:{json:string;day:string;key:string}|null=null;
    private appliedContext:{json:string;day:string;key:string}|null=null;
    private contextPump:Promise<void>|null=null;
    private generation=0;
    private retryCancel:(()=>void)|null=null;
    private retryDelay=1000;
    private owner:string|null=null;
    private unwatch:(()=>void)|null=null;
    private unsignal:(()=>void)|null=null;
    private token:string|null=null;
    private cancel=new Cancellation();
    constructor(private wire:Transport,readonly store:ProviderStore,private changed:(provider?:ProviderName)=>void,private connection:(state:ConnectionState)=>void){}
    setCalendarContext(context:CalendarContext,day:string):void{
        const json=JSON.stringify(context);this.desiredContext={json,day,key:json+day};
        // On failure leave the desired key unapplied; the next clock/resume tick retries.
        void this.syncContext().catch(()=>{});
    }
    private syncContext():Promise<void>{
        if(this.contextPump)return this.contextPump;
        if(!this.owner||!this.desiredContext||this.appliedContext?.key===this.desiredContext.key)return Promise.resolve();
        const owner=this.owner,generation=this.generation;
        const current=()=>owner===this.owner&&generation===this.generation;
        const pump=(async()=>{
            while(current()&&this.desiredContext&&this.appliedContext?.key!==this.desiredContext.key){
                const desired=this.desiredContext,previous=this.appliedContext;
                await this.wire.call(owner,'SetCalendarContext',[desired.json],this.cancel);
                if(!current())return;
                if(previous&&previous.day!==desired.day&&this.token){
                    await this.wire.call(owner,'Refresh',['calendar'],this.cancel).catch(()=>{});
                    if(!current())return;
                }
                this.appliedContext=desired;
            }
        })();
        this.contextPump=pump;
        void pump.finally(()=>{if(this.contextPump===pump)this.contextPump=null;}).catch(()=>{});
        return pump;
    }
    start(providers:ProviderName[]):void {
        this.stop();
        if(!providers.length || providers.some(p=>!PROVIDERS.includes(p))) throw new Error('Invalid providers');
        this.unwatch=this.wire.watchOwner(owner=>{this.retryDelay=1000;void this.connect(owner,[...new Set(providers)]);});
    }
    private release(owner:string,token:string):void {void this.wire.call(owner,'Unsubscribe',[token],null).catch(()=>{});}
    private disconnect():void {
        this.retryCancel?.();this.retryCancel=null;
        this.appliedContext=null;this.contextPump=null;
        this.generation++;this.cancel.cancel();this.cancel=new Cancellation();
        this.unsignal?.();this.unsignal=null;
        if(this.owner && this.token) this.release(this.owner,this.token);
        this.token=null;this.owner=null;this.store.resetOwner();
    }
    stop():void {this.retryDelay=1000;this.unwatch?.();this.unwatch=null;this.disconnect();this.connection('disconnected');}
    private async connect(owner:string|null,providers:ProviderName[]):Promise<void> {
        if(owner && owner===this.owner) return;
        this.disconnect();this.owner=owner;
        if(!owner){this.connection('disconnected');return;}
        const generation=this.generation;
        const current=()=>generation===this.generation && owner===this.owner;
        this.connection('connecting');
        this.unsignal=this.wire.watchChanges(owner,(name,revision,payload)=>{
            if(!current()) return;
            try {
                const provider=name as ProviderName;
                if(this.store.applyChange(provider,revision,parseProviderState(provider,payload))) this.changed(provider);
            } catch {this.connection('invalid-data');}
        });
        try {
            if(this.desiredContext){await this.syncContext();if(!current())return;}
            // Subscribe mutates server state. Let its reply arrive after disable so the
            // returned token can be released; cancelling would lose the cleanup handle.
            const [token]=await this.wire.call(owner,'Subscribe',[providers],null);
            if(typeof token!=='string' || !token || token.length>128) throw new Error('Invalid subscription');
            if(!current()){this.release(owner,token);return;}
            this.token=token;
            const [raw]=await this.wire.call(owner,'GetSnapshot',[],this.cancel);
            if(!current()) return;
            if(typeof raw!=='string') throw new Error('Invalid snapshot');
            this.store.acceptSnapshot(parseSnapshot(raw));this.retryDelay=1000;this.changed();this.connection('connected');
        } catch {
            if(current()) {
                this.disconnect();this.connection('unavailable');
                const retryGeneration=this.generation;
                const delay=this.retryDelay;this.retryDelay=Math.min(30000,delay*2);
                this.retryCancel=this.wire.schedule(delay,()=>{
                    this.retryCancel=null;
                    if(this.generation===retryGeneration) void this.connect(owner,providers);
                });
            }
        }
    }
}
