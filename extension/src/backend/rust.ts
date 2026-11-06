import {DataClient,type Transport} from '../shared/dataClient.js';
import type {ProviderName,CalendarContext} from '../types.js';
import type {WidgetDataSession,WidgetSessionOptions} from './contracts.js';
/** Preserves the existing Rust D-Bus client and its late-subscription cleanup. */
export class RustWidgetSession implements WidgetDataSession {
    private client:DataClient;
    private destroyed=false;
    constructor(transport:Transport,options:WidgetSessionOptions){
        this.client=new DataClient(transport,options.store,options.changed,options.connection);
    }
    start(providers:ProviderName[]):void{if(!this.destroyed)this.client.start(providers);}
    stop():void{if(!this.destroyed)this.client.stop();}
    setCalendarContext(context:CalendarContext,day:string):void{if(!this.destroyed)this.client.setCalendarContext(context,day);}
    refreshAfterResume():void{if(!this.destroyed)this.client.refreshAfterResume();}
    destroy():void{if(this.destroyed)return;this.destroyed=true;this.client.stop();}
}
