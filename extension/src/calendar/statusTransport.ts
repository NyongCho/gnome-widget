import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import type {Cancellation} from '../shared/dataClient.js';
import type {StatusTransport} from './statusClient.js';
import {STATUS_BUS,STATUS_PATH,STATUS_INTERFACE} from './statusContract.js';
import {DataFailure} from '../data/errors.js';
export class GioStatusTransport implements StatusTransport {
    constructor(private bus=Gio.DBus.session){}
    watchOwner(changed:(owner:string|null)=>void):()=>void{const id=Gio.bus_watch_name_on_connection(this.bus,STATUS_BUS,Gio.BusNameWatcherFlags.NONE,(_b,_n,owner)=>changed(owner),()=>changed(null));return()=>Gio.bus_unwatch_name(id);}
    watchChanges(owner:string,changed:(raw:string)=>void):()=>void{const id=this.bus.signal_subscribe(owner,STATUS_INTERFACE,'CalendarStatusChanged',STATUS_PATH,null,0,(_b,_s,_p,_i,_n,parameters)=>{const [raw]=parameters.deep_unpack() as [string];changed(raw);});return()=>this.bus.signal_unsubscribe(id);}
    call(owner:string,method:string,args:readonly unknown[],cancel:Cancellation|null):Promise<readonly unknown[]>{
        const signatures:Record<string,[string,string]>={WatchCalendar:['()','(ss)'],UnwatchCalendar:['(s)','()'],RefreshCalendar:['()','()']},signature=signatures[method];if(!signature)return Promise.reject(new DataFailure('INVALID_DATA'));
        const io=cancel?new Gio.Cancellable():null,unlink=cancel?.onCancel(()=>io!.cancel());
        return new Promise((resolve,reject)=>this.bus.call(owner,STATUS_PATH,STATUS_INTERFACE,method,new GLib.Variant(signature[0],args),new GLib.VariantType(signature[1]),Gio.DBusCallFlags.NO_AUTO_START,10000,io,(_b,result)=>{
            unlink?.();try{resolve(this.bus.call_finish(result).deep_unpack() as unknown[]);}catch{reject(new DataFailure('SERVICE_UNAVAILABLE'));}
        }));
    }
}
