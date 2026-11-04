import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

/** Local artwork with its own cancellable decode; no global per-file texture cache. */
export function mediaArtwork(uri:string|null,scale:number,resourceScale:number):St.Widget{
    const height=Math.round(44*scale),density=Math.max(1,Math.ceil(resourceScale));
    const frame=new St.Widget({width:height,height,y_align:Clutter.ActorAlign.CENTER,
        layout_manager:new Clutter.BinLayout(),content_gravity:Clutter.ContentGravity.RESIZE_ASPECT});
    const fallback=new St.Icon({icon_name:'audio-x-generic-symbolic',icon_size:height,
        x_align:Clutter.ActorAlign.CENTER,y_align:Clutter.ActorAlign.CENTER});
    frame.add_child(fallback);
    // HTTP belongs to the service. Missing, invalid, or unreadable art keeps the icon.
    if(!uri?.startsWith('file:///'))return frame;
    const cancellable=new Gio.Cancellable();let alive=true;
    frame.connect('destroy',()=>{alive=false;cancellable.cancel();});
    Gio.File.new_for_uri(uri).read_async(GLib.PRIORITY_DEFAULT,cancellable,(file,result)=>{
        let stream:Gio.FileInputStream;
        try{stream=file!.read_finish(result);}catch{return;}
        GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(stream,Math.round(78*scale)*density,height*density,true,cancellable,(_source,decoded)=>{
            try{
                const pixbuf=GdkPixbuf.Pixbuf.new_from_stream_finish(decoded);
                if(!alive)return;
                const width=pixbuf.get_width(),pixelsHigh=pixbuf.get_height();
                const content=new St.ImageContent({preferred_width:width/density,preferred_height:pixelsHigh/density});
                content.set_data(frame.get_context().get_backend().get_cogl_context(),pixbuf.get_pixels(),
                    pixbuf.get_has_alpha()?Cogl.PixelFormat.RGBA_8888:Cogl.PixelFormat.RGB_888,width,pixelsHigh,pixbuf.get_rowstride());
                frame.width=width/density;frame.content=content;fallback.hide();
            }catch{
                // Keep track metadata and the fallback when decoding fails or is cancelled.
            }finally{
                stream.close_async(GLib.PRIORITY_DEFAULT,null,(input,closed)=>{try{input!.close_finish(closed);}catch{}});
            }
        });
    });
    return frame;
}
