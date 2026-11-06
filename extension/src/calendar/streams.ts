import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {decodeJson,encodeFrame,frameLength,ProtocolFailure} from './protocol.js';

export class TruncatedFrameError extends ProtocolFailure {constructor(){super('INVALID_DATA');}}
export function readBytes(stream:Gio.InputStream,size:number,cancel:Gio.Cancellable):Promise<Uint8Array> {
    return new Promise((resolve,reject)=>stream.read_bytes_async(size,GLib.PRIORITY_DEFAULT,cancel,(source,result)=>{
        try{// Own the memory across the await boundary; the temporary GBytes may be collected.
            resolve(source!.read_bytes_finish(result).toArray().slice());}catch(e){reject(e);}
    }));
}
export async function readExact(stream:Gio.InputStream,size:number,cancel:Gio.Cancellable):Promise<Uint8Array> {
    const output=new Uint8Array(size);let offset=0;
    while(offset<size){const chunk=await readBytes(stream,Math.min(65536,size-offset),cancel);
        if(!chunk.length)throw new TruncatedFrameError();output.set(chunk,offset);offset+=chunk.length;}
    return output;
}
export async function readFrame(stream:Gio.InputStream,limit:number,cancel:Gio.Cancellable):Promise<unknown> {
    const length=frameLength(await readExact(stream,4,cancel),limit);
    return decodeJson(await readExact(stream,length,cancel));
}
export async function expectEof(stream:Gio.InputStream,cancel:Gio.Cancellable):Promise<void> {
    if((await readBytes(stream,1,cancel)).length)throw new ProtocolFailure('INVALID_DATA');
}
export async function writeBytes(stream:Gio.OutputStream,bytes:Uint8Array,cancel:Gio.Cancellable):Promise<void> {
    // Bounded chunks avoid marshalling a whole 5 MiB feed through one GI call.
    for(let offset=0;offset<bytes.length;){
        // GBytes keeps the marshalled buffer alive until asynchronous I/O finishes.
        // write_all_async's borrowed C array can outlive the GJS argument buffer.
        const chunk=new GLib.Bytes(bytes.subarray(offset,offset+65536));
        const written=await new Promise<number>((resolve,reject)=>stream.write_bytes_async(chunk,GLib.PRIORITY_DEFAULT,cancel,(source,result)=>{
            try{const count=source!.write_bytes_finish(result);if(count<=0)throw new ProtocolFailure('INVALID_DATA');resolve(count);}catch(e){reject(e);}
        }));
        offset+=written;
    }
}
export function writeFrame(stream:Gio.OutputStream,value:unknown,limit:number,cancel:Gio.Cancellable):Promise<void> {
    return writeBytes(stream,encodeFrame(value,limit),cancel);
}
export function closeStream(stream:Gio.InputStream|Gio.OutputStream):Promise<void> {
    return new Promise(resolve=>stream.close_async(GLib.PRIORITY_DEFAULT,null,(source,result)=>{try{source!.close_finish(result);}catch{/* Process cleanup still owns the descriptor. */}resolve();}));
}
