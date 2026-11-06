import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import type {Cancellation} from '../shared/dataClient.js';
import {DataCancelled,DataFailure,type DataErrorCode} from './errors.js';
export function checkIO(cancel:Gio.Cancellable):void {if(cancel.is_cancelled())throw new DataCancelled();}
export function gioAsync<T>(start:(callback:(source:unknown,result:Gio.AsyncResult)=>void)=>void,finish:(result:Gio.AsyncResult)=>T):Promise<T> {
    return new Promise((resolve,reject)=>start((_source,result)=>{try{resolve(finish(result));}catch(error){reject(error);}}));
}
/** The deadline includes initialization, all calls, and every streamed byte. */
export async function bounded<T>(cancel:Cancellation,ms:number,timeoutCode:DataErrorCode,fn:(io:Gio.Cancellable)=>Promise<T>):Promise<T> {
    if(cancel.cancelled)throw new DataCancelled();
    const io=new Gio.Cancellable();let timer=0,unlink=()=>{};
    const stop=new Promise<never>((_resolve,reject)=>{
        unlink=cancel.onCancel(()=>{io.cancel();reject(new DataCancelled());});
        timer=GLib.timeout_add(GLib.PRIORITY_DEFAULT,ms,()=>{timer=0;io.cancel();reject(new DataFailure(timeoutCode));return GLib.SOURCE_REMOVE;});
    });
    try{return await Promise.race([Promise.resolve().then(()=>{checkIO(io);return fn(io);}),stop]);}
    finally{unlink();if(timer)GLib.source_remove(timer);io.cancel();}
}
export function isIoError(error:unknown,code:number):boolean {
    return error instanceof GLib.Error&&error.matches(Gio.io_error_quark(),code);
}
