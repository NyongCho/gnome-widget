import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import type {Cancellation} from '../shared/dataClient.js';
import {bounded,gioAsync,checkIO,isIoError} from './async.js';
import {GioPrivateFiles} from './files.js';
import {acquireBusLease} from './busLease.js';
import {DataCancelled,DataFailure} from './errors.js';
import {ART_MAX_BYTES,artworkKind,type ArtworkStore} from './providers/mediaArt.js';
import {closeStream} from '../calendar/streams.js';
const ATTR='standard::name,standard::type,standard::is-symlink,standard::size,unix::mode,unix::inode,unix::device,time::modified';
const ART=/^[a-f0-9]{64}\.art$/,TEMP=/^\.tmp-[a-f0-9-]{36}$/;
const name=(uri:string)=>`${GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256,uri,-1)}.art`;
function regular(info:Gio.FileInfo,privateFile:boolean):boolean{return info.get_file_type()===Gio.FileType.REGULAR&&!(info.has_attribute('standard::is-symlink')&&info.get_is_symlink())&&info.get_size()>0&&info.get_size()<=ART_MAX_BYTES&&(!privateFile||(info.get_attribute_uint32('unix::mode')&0o777)===0o600);}
export class GioArtworkStore implements ArtworkStore {
    private files:GioPrivateFiles;private directory:Gio.File;
    constructor(path:string){this.files=new GioPrivateFiles(path);this.directory=Gio.File.new_for_path(path);}
    private async validate(file:Gio.File,privateFile:boolean,cancel:Cancellation):Promise<string|null>{
        try{return await bounded(cancel,5000,'SERVICE_UNAVAILABLE',async io=>{
            const before=await gioAsync(cb=>file.query_info_async(ATTR,Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,0,io,cb),r=>file.query_info_finish(r));if(!regular(before,privateFile))return null;checkIO(io);
            const stream=await gioAsync(cb=>file.read_async(0,io,cb),r=>file.read_finish(r));
            try{const opened=await gioAsync(cb=>stream.query_info_async(ATTR,0,io,cb),r=>stream.query_info_finish(r));
                if(!regular(opened,privateFile)||before.get_attribute_uint64('unix::inode')!==opened.get_attribute_uint64('unix::inode')||before.get_attribute_uint32('unix::device')!==opened.get_attribute_uint32('unix::device'))return null;
                return file.get_uri();
            }finally{await closeStream(stream);}
        });}catch(error){if(cancel.cancelled||error instanceof DataCancelled)throw new DataCancelled();return null;}
    }
    async local(uri:string,cancel:Cancellation):Promise<string|null>{
        if(artworkKind(uri)!=='local')return null;
        try{const [path,host]=GLib.filename_from_uri(uri);if(host||!GLib.path_is_absolute(path))return null;return await this.validate(Gio.File.new_for_path(path),false,cancel);}catch{if(cancel.cancelled)throw new DataCancelled();return null;}
    }
    private async locked<T>(cancel:Cancellation,fn:()=>Promise<T>):Promise<T>{
        const lease=await acquireBusLease('io.github.NyongCho.LiquidWidgets.ArtworkCache',5000,cancel);
        try{await this.files.prepare(cancel);if(cancel.cancelled)throw new DataCancelled();return await fn();}finally{lease.release();}
    }
    cached(uri:string,cancel:Cancellation):Promise<string|null>{return this.locked(cancel,()=>this.validate(this.directory.get_child(name(uri)),true,cancel));}
    async put(uri:string,bytes:Uint8Array,cancel:Cancellation):Promise<string|null>{
        if(artworkKind(uri)!=='remote'||!bytes.length||bytes.length>ART_MAX_BYTES)return null;
        return this.locked(cancel,async()=>{
            const target=name(uri);
            // Cross-session lease also protects cleanup from another live writer's temporary file.
            await bounded(cancel,5000,'SERVICE_UNAVAILABLE',async io=>{
                const enumerator=await gioAsync(cb=>this.directory.enumerate_children_async(ATTR,Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,0,io,cb),r=>this.directory.enumerate_children_finish(r));
                const entries:Gio.FileInfo[]=[];let seen=0;
                const remove=async(info:Gio.FileInfo)=>{if(info.get_file_type()===Gio.FileType.DIRECTORY)throw new DataFailure('INVALID_DATA');const file=this.directory.get_child(info.get_name());checkIO(io);try{await gioAsync(cb=>file.delete_async(0,io,cb),r=>file.delete_finish(r));}catch(e){if(!isIoError(e,Gio.IOErrorEnum.NOT_FOUND))throw e;}};
                try{for(;;){const batch=await gioAsync(cb=>enumerator.next_files_async(32,0,io,cb),r=>enumerator.next_files_finish(r));if(!batch.length)break;seen+=batch.length;if(seen>512)throw new DataFailure('PAYLOAD_TOO_LARGE');
                    for(const info of batch){const filename=info.get_name();if(TEMP.test(filename)||ART.test(filename)&&(!regular(info,true)||filename===target))await remove(info);else if(ART.test(filename))entries.push(info);}
                }}finally{await gioAsync(cb=>enumerator.close_async(0,null,cb),r=>enumerator.close_finish(r)).catch(()=>{});}
                let total=entries.reduce((sum,info)=>sum+info.get_size(),0),count=entries.length;
                entries.sort((a,b)=>a.get_attribute_uint64('time::modified')-b.get_attribute_uint64('time::modified')||a.get_name().localeCompare(b.get_name()));
                for(const info of entries){if(count<64&&total+bytes.length<=64*1024*1024)break;await remove(info);total-=info.get_size();count--;}
            });
            if(cancel.cancelled)throw new DataCancelled();await this.files.replace(target,bytes,cancel);return this.validate(this.directory.get_child(target),true,cancel);
        });
    }
}
