import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import Gio from 'gi://Gio';
import {loadArtworkPixbuf} from './artworkDecode.js';
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
    void loadArtworkPixbuf(uri,Math.round(78*scale)*density,height*density,cancellable).then(pixbuf=>{
        if(!alive)return;
        try{
            const width=pixbuf.get_width(),pixelsHigh=pixbuf.get_height();
            const content=new St.ImageContent({preferred_width:width/density,preferred_height:pixelsHigh/density});
            content.set_data(frame.get_context().get_backend().get_cogl_context(),pixbuf.get_pixels(),
                pixbuf.get_has_alpha()?Cogl.PixelFormat.RGBA_8888:Cogl.PixelFormat.RGB_888,width,pixelsHigh,pixbuf.get_rowstride());
            frame.width=width/density;frame.content=content;fallback.hide();
        }catch{/* Invalid pixels keep the fallback. */}
    },()=>{/* Missing, broken or cancelled artwork keeps metadata and the icon. */});
    return frame;
}
