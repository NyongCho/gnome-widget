import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {Cancellation,type ChangeHandler,type Transport} from './shared/dataClient.js';
export const BUS_NAME='org.local.LiquidWidgets';
const PATH='/org/local/LiquidWidgets';
const IFACE='org.local.LiquidWidgets1';
const signatures:Record<string,string>={Subscribe:'(as)',Unsubscribe:'(s)',Refresh:'(s)',SetCalendarContext:'(s)',SetCalendarSecret:'(s)',SearchLocations:'(s)',SetWeatherLocation:'(s)',SetNetworkInterface:'(s)'};
/** Owns watches/cancellables, never closes the shared GJS session connection. */
export class SessionTransport implements Transport {
    constructor(private bus=Gio.DBus.session){}
    schedule(delay:number,callback:()=>void):()=>void {
        const id=GLib.timeout_add(GLib.PRIORITY_DEFAULT,delay,()=>{callback();return GLib.SOURCE_REMOVE;});
        return()=>{GLib.source_remove(id);};
    }
    watchOwner(callback:(owner:string|null)=>void):()=>void {
        const id=Gio.bus_watch_name_on_connection(this.bus,BUS_NAME,Gio.BusNameWatcherFlags.NONE,
            (_bus,_name,owner)=>callback(owner),()=>callback(null));
        return()=>Gio.bus_unwatch_name(id);
    }
    watchChanges(owner:string,callback:ChangeHandler):()=>void {
        const id=this.bus.signal_subscribe(owner,IFACE,'ProviderChanged',PATH,null,Gio.DBusSignalFlags.NONE,
            (_bus,_sender,_path,_interface,_signal,parameters)=>{
                const [name,revision,payload]=parameters.deep_unpack() as [string,number,string];
                callback(name,revision,payload);
            });
        return()=>this.bus.signal_unsubscribe(id);
    }
    call(owner:string,method:string,args:readonly unknown[],cancel:Cancellation|null):Promise<readonly unknown[]> {
        const cancellable=new Gio.Cancellable();
        const off=cancel?.onCancel(()=>cancellable.cancel());
        return new Promise((resolve,reject)=>{
            const signature=signatures[method];
            const parameters=signature?new GLib.Variant(signature,args):null;
            this.bus.call(owner,PATH,IFACE,method,parameters,null,Gio.DBusCallFlags.NO_AUTO_START,10000,cancellable,
                (bus,result)=>{off?.();try{resolve(bus!.call_finish(result).deep_unpack() as unknown[]);}catch{reject(new Error('Service call failed'));}});
        });
    }
}
