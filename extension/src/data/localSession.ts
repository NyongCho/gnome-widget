import type {WidgetDataSession,WidgetSessionOptions} from '../backend/contracts.js';
import {Cancellation} from '../shared/dataClient.js';
import {PROVIDERS} from '../shared/providerStore.js';
import type {CalendarContext,ProviderName} from '../types.js';
import {defaultConfig,type ConfigStore,type DataConfig} from './config.js';
import {ProviderScheduler,type Driver} from './scheduler.js';
export interface SessionClock {monotonic():number;now():string;schedule(ms:number,fn:()=>void):()=>void}
export interface LocalSessionDependencies {
    config:Pick<ConfigStore,'read'|'watch'>;clock:SessionClock;
    drivers:Partial<{[K in ProviderName]:Driver<K>}>;
    destroy?():void|Promise<void>;
}
export class LocalWidgetSession implements WidgetDataSession {
    readonly ready:Promise<void>;drained:Promise<void>=Promise.resolve();
    private dead=false;private initCancel=new Cancellation();private unwatch:(()=>void)|null=null;
    private configEpoch=0;private config=defaultConfig();private cards=new Set<ProviderName>();private watchers=0;
    private retryInitialization:(()=>void)|null=null;private retryDelay=1000;
    private context:CalendarContext={month:'1970-01',timeZone:'UTC',weekStart:0};private day='';
    private schedulers=new Map<ProviderName,ProviderScheduler<ProviderName>>();
    constructor(private options:WidgetSessionOptions,private deps:LocalSessionDependencies){
        options.store.resetOwner();
        for(const name of PROVIDERS)this.schedulers.set(name,new ProviderScheduler(name,deps.drivers[name],deps.clock,()=>options.store.get(name),(revision,state)=>{
            if(!this.dead&&options.store.applyChange(name,revision,state))options.changed(name);
        }));
        this.ready=this.initialize();
    }
    private async initialize():Promise<void>{
        const attemptEpoch=this.configEpoch;
        try{
            // First read creates the private directory; watching before the second
            // read closes the initialization/change race without polling.
            await this.deps.config.read(this.initCancel);if(this.dead)return;
            if(!this.unwatch)this.unwatch=this.deps.config.watch(config=>{if(!this.dead){this.configEpoch++;this.applyConfig(config);this.recovered();}});
            const epoch=this.configEpoch;
            const config=await this.deps.config.read(this.initCancel);if(this.dead)return;
            if(epoch===this.configEpoch)this.applyConfig(config);this.recovered();
        }catch{if(!this.dead&&attemptEpoch===this.configEpoch){
            this.sync();this.options.connection('unavailable');
            this.retryInitialization?.();
            this.retryInitialization=this.deps.clock.schedule(this.retryDelay,()=>{this.retryInitialization=null;void this.initialize();});
            this.retryDelay=Math.min(30000,this.retryDelay*2);
        }}
    }
    private recovered():void {
        this.retryInitialization?.();this.retryInitialization=null;this.retryDelay=1000;
        this.options.connection('connected');
    }
    private applyConfig(config:DataConfig):void {
        const pendingChanged=this.config.calendar.deletionPending!==config.calendar.deletionPending;
        this.config=config;this.sync();
        // Invalidate preferences settings through the existing status channel;
        // cleanup flags do not change the collector's source or restart work.
        if(pendingChanged)this.options.changed('calendar');
    }
    private sync():void {
        if(this.dead)return;
        for(const name of PROVIDERS){
            const detail=name==='calendar'?[this.config.calendar.sourceId,this.config.calendar.enabled,this.context,this.day]:
                name==='weather'?this.config.weather:name==='network'?this.config.networkInterface:name;
            this.schedulers.get(name)!.configure({config:this.config,calendarContext:this.context},JSON.stringify(detail),this.cards.has(name)||name==='calendar'&&this.watchers>0);
        }
    }
    start(providers:ProviderName[]):void {if(this.dead)return;if(providers.some(name=>!PROVIDERS.includes(name)))throw new Error('Invalid providers');this.cards=new Set(providers);this.sync();}
    stop():void {if(this.dead)return;this.cards.clear();this.sync();}
    setCalendarWatchers(count:number):void{if(this.dead)return;this.watchers=Math.max(0,Math.trunc(count));this.sync();}
    setCalendarContext(context:CalendarContext,day:string):void {if(this.dead)return;this.context={...context};this.day=day;this.sync();}
    calendarStatus(){return{state:this.options.store.get('calendar'),context:{...this.context},generation:this.schedulers.get('calendar')!.generation};}
    refresh(name:ProviderName):void{if(!this.dead)this.schedulers.get(name)?.refresh();}
    refreshAfterResume():void{if(!this.dead)for(const scheduler of this.schedulers.values())scheduler.resume();}
    destroy():void {
        if(this.dead)return;this.dead=true;this.initCancel.cancel();this.retryInitialization?.();this.retryInitialization=null;this.unwatch?.();this.unwatch=null;
        for(const scheduler of this.schedulers.values())scheduler.destroy();
        const cleanup:Promise<unknown>[]=[];
        for(const driver of Object.values(this.deps.drivers)){try{cleanup.push(Promise.resolve(driver?.destroy?.()));}catch{/* Cleanup continues for all providers. */}}
        try{cleanup.push(Promise.resolve(this.deps.destroy?.()));}catch{/* Remaining cleanup is still awaited. */}
        this.drained=Promise.allSettled(cleanup).then(()=>{});
    }
}
