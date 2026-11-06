import type {Cancellation} from '../shared/dataClient.js';
import type {PrivateFiles} from './contracts.js';
export type {PrivateFiles} from './contracts.js';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {bounded,gioAsync,checkIO,isIoError} from './async.js';
import {DataFailure,DataCancelled} from './errors.js';
import {readBytes,writeBytes,closeStream} from '../calendar/streams.js';
const ATTR='standard::type,standard::is-symlink,standard::size,unix::mode,unix::inode,unix::device';
function info(file:Gio.File,io:Gio.Cancellable):Promise<Gio.FileInfo>{return gioAsync(cb=>file.query_info_async(ATTR,Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,0,io,cb),r=>file.query_info_finish(r));}
function regular(data:Gio.FileInfo):void{if(data.has_attribute('standard::is-symlink')&&data.get_is_symlink()||data.get_file_type()!==Gio.FileType.REGULAR)throw new DataFailure('INVALID_DATA');}
export class GioPrivateFiles implements PrivateFiles {
    private base:Gio.File;
    constructor(baseDir:string){if(!GLib.path_is_absolute(baseDir))throw new DataFailure('INVALID_DATA');this.base=Gio.File.new_for_path(baseDir);}
    private file(name:string):Gio.File {if(!name||name==='.'||name==='..'||name.includes('/')||name.includes('\0'))throw new DataFailure('INVALID_DATA');return this.base.get_child(name);}
    private async directory(io:Gio.Cancellable):Promise<void>{
        const ensure=async(file:Gio.File):Promise<void>=>{
            try{const data=await info(file,io);if(data.has_attribute('standard::is-symlink')&&data.get_is_symlink()||data.get_file_type()!==Gio.FileType.DIRECTORY)throw new DataFailure('INVALID_DATA');}
            catch(error){if(!isIoError(error,Gio.IOErrorEnum.NOT_FOUND))throw error;const parent=file.get_parent();if(!parent)throw error;await ensure(parent);checkIO(io);
                try{await gioAsync(cb=>file.make_directory_async(0,io,cb),r=>file.make_directory_finish(r));}catch(e){if(!isIoError(e,Gio.IOErrorEnum.EXISTS))throw e;}
                const created=await info(file,io);if(created.has_attribute('standard::is-symlink')&&created.get_is_symlink()||created.get_file_type()!==Gio.FileType.DIRECTORY)throw new DataFailure('INVALID_DATA');
            }
        };
        await ensure(this.base);const attributes=new Gio.FileInfo();attributes.set_attribute_uint32('unix::mode',0o700);checkIO(io);
        await gioAsync(cb=>this.base.set_attributes_async(attributes,Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,0,io,cb),r=>this.base.set_attributes_finish(r));
    }
    private async safe<T>(cancel:Cancellation,fn:(io:Gio.Cancellable)=>Promise<T>):Promise<T>{
        try{return await bounded(cancel,5000,'SERVICE_UNAVAILABLE',fn);}catch(error){if(error instanceof DataFailure||error instanceof DataCancelled)throw error;throw new DataFailure('SERVICE_UNAVAILABLE');}
    }
    read(name:string,maxBytes:number,cancel:Cancellation):Promise<Uint8Array|null>{
        return this.safe(cancel,async io=>{
            const file=this.file(name);await this.directory(io);let before:Gio.FileInfo;
            try{before=await info(file,io);}catch(error){if(isIoError(error,Gio.IOErrorEnum.NOT_FOUND))return null;throw error;}
            regular(before);if(before.get_size()>maxBytes)throw new DataFailure('PAYLOAD_TOO_LARGE');checkIO(io);
            const stream=await gioAsync(cb=>file.read_async(0,io,cb),r=>file.read_finish(r));
            try{
                const opened=await gioAsync(cb=>stream.query_info_async(ATTR,0,io,cb),r=>stream.query_info_finish(r));regular(opened);
                if(before.get_attribute_uint64('unix::inode')!==opened.get_attribute_uint64('unix::inode')||before.get_attribute_uint32('unix::device')!==opened.get_attribute_uint32('unix::device'))throw new DataFailure('INVALID_DATA');
                const chunks:Uint8Array[]=[];let size=0;
                for(;;){const bytes=await readBytes(stream,Math.min(65536,maxBytes-size+1),io);if(!bytes.length)break;size+=bytes.length;if(size>maxBytes)throw new DataFailure('PAYLOAD_TOO_LARGE');chunks.push(bytes);}
                const output=new Uint8Array(size);let offset=0;for(const bytes of chunks){output.set(bytes,offset);offset+=bytes.length;}return output;
            }finally{await closeStream(stream);}
        });
    }
    replace(name:string,bytes:Uint8Array,cancel:Cancellation):Promise<void>{
        return this.safe(cancel,async io=>{
            const target=this.file(name);await this.directory(io);
            try{regular(await info(target,io));}catch(error){if(!isIoError(error,Gio.IOErrorEnum.NOT_FOUND))throw error;}
            const temporary=this.base.get_child(`.tmp-${GLib.uuid_string_random()}`);let stream:Gio.FileOutputStream|null=null;
            try{
                checkIO(io);stream=await gioAsync(cb=>temporary.create_async(Gio.FileCreateFlags.PRIVATE,0,io,cb),r=>temporary.create_finish(r));
                await writeBytes(stream,bytes,io);await closeStream(stream);stream=null;checkIO(io);
                try{regular(await info(target,io));}catch(error){if(!isIoError(error,Gio.IOErrorEnum.NOT_FOUND))throw error;}
                await gioAsync(cb=>temporary.move_async(target,Gio.FileCopyFlags.OVERWRITE|Gio.FileCopyFlags.NOFOLLOW_SYMLINKS,0,io,null,cb),r=>temporary.move_finish(r));
            }finally{
                if(stream)await closeStream(stream);
                try{await gioAsync(cb=>temporary.delete_async(0,null,cb),r=>temporary.delete_finish(r));}catch{/* A successful atomic rename removed it. */}
            }
        });
    }
    remove(name:string,cancel:Cancellation):Promise<void>{return this.safe(cancel,async io=>{
        const file=this.file(name);await this.directory(io);
        try{regular(await info(file,io));checkIO(io);await gioAsync(cb=>file.delete_async(0,io,cb),r=>file.delete_finish(r));}
        catch(error){if(!isIoError(error,Gio.IOErrorEnum.NOT_FOUND))throw error;}
    });}
    watch(changed:()=>void):()=>void {
        const monitor=this.base.monitor_directory(Gio.FileMonitorFlags.NONE,null);
        const id=monitor.connect('changed',()=>changed());
        return()=>{monitor.disconnect(id);monitor.cancel();};
    }
}
