import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import type {Cancellation} from '../shared/dataClient.js';
import type {LinuxFiles} from './contracts.js';
import {bounded,gioAsync,checkIO} from './async.js';
import {DataFailure,DataCancelled} from './errors.js';
import {readBytes,closeStream} from '../calendar/streams.js';
/** Read-only proc/sysfs access. A test root allows identical GIO paths on fixtures. */
export class GioLinuxFiles implements LinuxFiles {
    constructor(private root=''){if(root&&!GLib.path_is_absolute(root))throw new DataFailure('INVALID_DATA');}
    private file(path:string):Gio.File {
        if(!/^\/(?:proc|sys)\//.test(path)||path.split('/').includes('..')||path.includes('\0'))throw new DataFailure('INVALID_DATA');
        return Gio.File.new_for_path(`${this.root}${path}`);
    }
    private async use<T>(cancel:Cancellation,fn:(io:Gio.Cancellable)=>Promise<T>):Promise<T>{
        try{return await bounded(cancel,2000,'SERVICE_UNAVAILABLE',fn);}catch(error){if(error instanceof DataFailure||error instanceof DataCancelled)throw error;throw new DataFailure('SERVICE_UNAVAILABLE');}
    }
    readText(path:string,maxBytes:number,cancel:Cancellation):Promise<string>{return this.use(cancel,async io=>{
        const file=this.file(path),attributes='standard::type';
        // Hardware directories legitimately contain symlinks; the opened target
        // must still be a regular file, never a FIFO or device stream.
        const before=await gioAsync(cb=>file.query_info_async(attributes,Gio.FileQueryInfoFlags.NONE,0,io,cb),r=>file.query_info_finish(r));
        if(before.get_file_type()!==Gio.FileType.REGULAR)throw new DataFailure('INVALID_DATA');checkIO(io);
        // sysfs st_size is commonly 4096 for a short attribute (procfs may say 0).
        // Enforce the bound on bytes actually read, below, rather than this metadata.
        const stream=await gioAsync(cb=>file.read_async(0,io,cb),r=>file.read_finish(r));
        try{
            const opened=await gioAsync(cb=>stream.query_info_async(attributes,0,io,cb),r=>stream.query_info_finish(r));if(opened.get_file_type()!==Gio.FileType.REGULAR)throw new DataFailure('INVALID_DATA');
            const chunks:Uint8Array[]=[];let length=0;
            for(;;){const bytes=await readBytes(stream,Math.min(65536,maxBytes-length+1),io);if(!bytes.length)break;length+=bytes.length;if(length>maxBytes)throw new DataFailure('PAYLOAD_TOO_LARGE');chunks.push(bytes);}
            const result=new Uint8Array(length);let offset=0;for(const bytes of chunks){result.set(bytes,offset);offset+=bytes.length;}
            try{return new TextDecoder('utf-8',{fatal:true}).decode(result);}catch{throw new DataFailure('INVALID_DATA');}
        }finally{await closeStream(stream);}
    });}
    listNames(path:string,maxEntries:number,cancel:Cancellation):Promise<string[]>{return this.use(cancel,async io=>{
        const file=this.file(path),enumerator=await gioAsync(cb=>file.enumerate_children_async('standard::name',Gio.FileQueryInfoFlags.NONE,0,io,cb),r=>file.enumerate_children_finish(r));
        try{
            const names:string[]=[];
            while(names.length<maxEntries){const rows=await gioAsync(cb=>enumerator.next_files_async(Math.min(32,maxEntries-names.length),0,io,cb),r=>enumerator.next_files_finish(r));if(!rows.length)break;for(const row of rows)names.push(row.get_name());}
            return names.sort();
        }finally{await gioAsync(cb=>enumerator.close_async(0,null,cb),r=>enumerator.close_finish(r)).catch(()=>{});}
    });}
}
