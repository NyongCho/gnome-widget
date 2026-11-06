import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {Cancellation} from '../shared/dataClient.js';

export interface BusLease {release(): void}
export class LeaseBusyError extends Error {constructor(){super('LEASE_BUSY');}}
export class LeaseTimeoutError extends Error {constructor(){super('LEASE_TIMEOUT');}}
export class CancelledError extends Error {constructor(){super('CANCELLED');}}
const BUS='org.freedesktop.DBus', PATH='/org/freedesktop/DBus';

function close(connection:Gio.DBusConnection):void {
    connection.close(null,(source,result)=>{try{source!.close_finish(result);}catch{/* Already disconnected. */}});
}
/** Every lease owns a private connection: releasing it never closes Shell's bus. */
function watchName(name:string,timeoutMs:number,cancel:Cancellation,acquire:boolean):Promise<BusLease> {
    if(cancel.cancelled)return Promise.reject(new CancelledError());
    return new Promise((resolve,reject)=>{
        let connection:Gio.DBusConnection|null=null,signal=0,timer=0,done=false,inFlight=false,dirty=false;
        const io=new Gio.Cancellable();
        let unlisten=()=>{};
        const cleanup=()=>{
            unlisten();if(timer){GLib.source_remove(timer);timer=0;}
            if(signal&&connection){connection.signal_unsubscribe(signal);signal=0;}
        };
        const fail=(error:Error)=>{
            if(done)return;done=true;cleanup();io.cancel();if(connection)close(connection);reject(error);
        };
        const succeed=()=>{
            if(done)return;done=true;cleanup();
            const owned=connection!;let released=false;
            resolve({release(){if(!released){released=true;close(owned);}}});
        };
        unlisten=cancel.onCancel(()=>fail(new CancelledError()));
        if(timeoutMs>0)timer=GLib.timeout_add(GLib.PRIORITY_DEFAULT,timeoutMs,()=>{timer=0;fail(new LeaseTimeoutError());return GLib.SOURCE_REMOVE;});
        const check=()=>{
            if(done||!connection)return;
            if(inFlight){dirty=true;return;}inFlight=true;dirty=false;
            connection.call(BUS,PATH,BUS,acquire?'RequestName':'NameHasOwner',
                acquire?new GLib.Variant('(su)',[name,4]):new GLib.Variant('(s)',[name]),
                new GLib.VariantType(acquire?'(u)':'(b)'),Gio.DBusCallFlags.NONE,Math.max(1000,timeoutMs),io,(source,result)=>{
                    try{
                        const [value]=source!.call_finish(result).deep_unpack() as [number|boolean];
                        inFlight=false;if(done)return;
                        if(acquire?(value===1||value===4):value===false){succeed();return;}
                        if(timeoutMs===0){fail(new LeaseBusyError());return;}
                        if(dirty)check();
                    }catch{inFlight=false;fail(cancel.cancelled?new CancelledError():new Error('BUS_UNAVAILABLE'));}
                });
        };
        try {
            const address=Gio.dbus_address_get_for_bus_sync(Gio.BusType.SESSION,null);
            Gio.DBusConnection.new_for_address(address,Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT|Gio.DBusConnectionFlags.MESSAGE_BUS_CONNECTION,null,io,(_source,result)=>{
                try {
                    const opened=Gio.DBusConnection.new_for_address_finish(result);opened.set_exit_on_close(false);
                    if(done){close(opened);return;}connection=opened;
                    signal=opened.signal_subscribe(BUS,BUS,'NameOwnerChanged',PATH,name,Gio.DBusSignalFlags.NONE,()=>check());
                    check();
                }catch{fail(cancel.cancelled?new CancelledError():new Error('BUS_UNAVAILABLE'));}
            });
        }catch{fail(new Error('BUS_UNAVAILABLE'));}
    });
}
export function acquireBusLease(name:string,timeoutMs:number,cancel:Cancellation):Promise<BusLease> {
    return watchName(name,timeoutMs,cancel,true);
}
/** Parent watches the computing worker's name; it never acquires that name itself. */
export async function waitBusNameFree(name:string,timeoutMs:number,cancel:Cancellation):Promise<void> {
    const observer=await watchName(name,timeoutMs,cancel,false);observer.release();
}
