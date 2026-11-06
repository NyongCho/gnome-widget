import Gio from 'gi://Gio';
import GdkPixbuf from 'gi://GdkPixbuf';
import {gioAsync} from '../data/async.js';
import {closeStream} from '../calendar/streams.js';
/** Shared async scaled decode; preserve aspect ratio for wide videos and square albums. */
export async function loadArtworkPixbuf(uri:string,width:number,height:number,cancel:Gio.Cancellable):Promise<GdkPixbuf.Pixbuf>{
    if(!uri.startsWith('file:///'))throw new Error('INVALID_DATA');
    const file=Gio.File.new_for_uri(uri),stream=await gioAsync(cb=>file.read_async(0,cancel,cb),r=>file.read_finish(r));
    try{return await gioAsync(cb=>GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(stream,width,height,true,cancel,cb),r=>GdkPixbuf.Pixbuf.new_from_stream_finish(r));}
    finally{await closeStream(stream);}
}
