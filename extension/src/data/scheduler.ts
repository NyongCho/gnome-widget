import {Cancellation} from '../shared/dataClient.js';
import type {ProviderMap,ProviderName,CalendarContext} from '../types.js';
import type {DataConfig} from './config.js';
import type {SessionClock} from './localSession.js';
import {providerSource,loadingState,failedState,checkedState} from './state.js';
import {DataFailure} from './errors.js';
export interface ProviderContext {config:DataConfig;calendarContext:CalendarContext;now:string;cancel:Cancellation}
export interface ProviderDriver<K extends ProviderName> {collect(context:ProviderContext):Promise<ProviderMap[K]>;reset?():void;destroy?():void|Promise<void>}
export interface SignalProviderDriver<K extends ProviderName> {start(publish:(state:ProviderMap[K])=>void,cancel:Cancellation):void;reset?():void;destroy?():void|Promise<void>}
export type Driver<K extends ProviderName>=ProviderDriver<K>|SignalProviderDriver<K>;
const INTERVALS:Record<ProviderName,number>={calendar:300000,weather:900000,system:2000,network:2000,media:0};
type Context=Omit<ProviderContext,'cancel'|'now'>;
export class ProviderScheduler<K extends ProviderName> {
    generation=0;
    private revision=0;private enabled=false;private dead=false;private key='';private source:string|null=null;
    private context:Context|null=null;private active:{cancel:Cancellation}|null=null;private event:Cancellation|null=null;
    private timer:(()=>void)|null=null;private pending=false;private failures=0;private lastManual=-Infinity;
    constructor(private name:K,private driver:Driver<K>|undefined,private clock:SessionClock,
        private previous:()=>ProviderMap[K],private publish:(revision:number,state:ProviderMap[K])=>void){}
    configure(context:Context,key:string,enabled:boolean):void {
        if(this.dead)return;this.context=context;
        if(key===this.key&&enabled===this.enabled)return;
        const changed=key!==this.key;this.key=key;this.enabled=enabled;this.source=providerSource(this.name,context.config);this.failures=0;
        this.invalidate();
        if(changed||enabled)this.emit(loadingState(this.name,this.source,this.previous(),context.calendarContext));
        if(enabled&&this.source!==null)this.request();
    }
    private emit(state:ProviderMap[K]):void {if(!this.dead)this.publish(++this.revision,state);}
    private invalidate():void {
        this.generation++;this.timer?.();this.timer=null;this.pending=false;this.active?.cancel.cancel();this.event?.cancel();this.event=null;
    }
    refresh(manual=true):void {
        if(this.dead||!this.enabled||this.source===null)return;
        if(manual){const now=this.clock.monotonic(),limit=this.name==='weather'?60000:5000;if(now-this.lastManual<limit)return;this.lastManual=now;}
        this.invalidate();this.request();
    }
    resume():void {this.driver?.reset?.();this.refresh(false);}
    private request():void {
        if(this.dead||!this.enabled||this.source===null||!this.context)return;
        if(this.active){this.pending=true;return;}
        this.pending=false;this.timer?.();this.timer=null;
        const generation=++this.generation,cancel=new Cancellation(),context={...this.context,now:this.clock.now(),cancel},source=this.source;
        const current=()=>!this.dead&&this.enabled&&generation===this.generation&&!cancel.cancelled;
        this.emit(loadingState(this.name,source,this.previous(),context.calendarContext));
        const accept=(state:ProviderMap[K])=>{
            if(!current())return;
            try{const checked=checkedState(this.name,state,source,context.calendarContext);this.failures=checked.status==='ok'?0:this.failures+1;this.emit(checked);}
            catch(error){fail(error);}
        };
        const fail=(error:unknown)=>{if(current()){this.failures++;this.emit(failedState(this.name,source,this.previous(),context.calendarContext,error));}};
        if(this.driver&&'start' in this.driver){this.event=cancel;try{this.driver.start(accept,cancel);}catch(error){fail(error);}return;}
        const active={cancel};this.active=active;
        void Promise.resolve().then(()=>{
            if(cancel.cancelled)throw new Error('CANCELLED');
            if(!this.driver||!('collect' in this.driver))throw new DataFailure('SERVICE_UNAVAILABLE');return this.driver.collect(context);
        }).then(accept,fail).finally(()=>{
            if(this.active===active)this.active=null;
            if(this.dead||!this.enabled||this.source===null)return;
            if(this.pending){this.request();return;}
            const interval=this.name==='weather'&&this.failures?Math.min(900000,30000*2**Math.min(5,this.failures-1)):INTERVALS[this.name];
            if(interval)this.timer=this.clock.schedule(interval,()=>{this.timer=null;this.request();});
        });
    }
    destroy():void {if(this.dead)return;this.dead=true;this.enabled=false;this.invalidate();}
}
