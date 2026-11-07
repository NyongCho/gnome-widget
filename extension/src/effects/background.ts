import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import {GlassEffect} from './glass.js';
import {WallpaperClone, type Rect} from '../platform/gnome50.js';
export class GlassSurface {
    readonly actor = new Clutter.Actor();
    private source = new Clutter.Actor({clip_to_allocation:true});
    private effect = new GlassEffect();
    private failedSignal:number;
    private wallpaper: WallpaperClone;
    private fallbackIdle=0;
    constructor(monitorIndex:number,onFallback:()=>void=()=>{}) {
        this.actor.add_child(this.source);
        this.source.add_effect(this.effect);
        this.failedSignal=this.effect.connect('failed',()=>{
            this.fallbackIdle=GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE,()=>{
                this.fallbackIdle=0;this.source.hide();onFallback();return GLib.SOURCE_REMOVE;
            });
        });
        this.wallpaper = new WallpaperClone(this.source, monitorIndex, this.effect.padding, () => this.effect.invalidate());
    }
    // GNOME resource scale is authoritative (125% currently allocates at 2x).
    // Keep the logical scale argument for the shared surface interface.
    setGeometry(rect:Rect, _scale:number, worldRect:Rect=rect):void {
        this.actor.set_position(rect.x,rect.y);
        this.actor.set_size(rect.width,rect.height);
        const p=this.effect.padding;
        this.source.set_position(-p,-p);
        this.source.set_size(rect.width+2*p,rect.height+2*p);
        this.wallpaper.setGeometry(worldRect);
    }
    get fallback():boolean{return this.effect.failed;}
    setEnabled(enabled:boolean):void { this.source.visible=enabled&&!this.fallback; if(!enabled)this.effect.release(); }
    setStrength(value:number):void { this.effect.setStrength(value); }
    setMaterial(opacity:number,dark:boolean):void { this.effect.setMaterial(opacity,dark); }
    get diagnostics():object { return {inputPaints:this.effect.inputPaints,blurPaints:this.effect.blurPaints,outputPaints:this.effect.outputPaints,textureBytes:this.effect.textureBytes}; }
    destroy():void {
        this.effect.disconnect(this.failedSignal);
        if(this.fallbackIdle)GLib.Source.remove(this.fallbackIdle);
        this.fallbackIdle=0;
        this.wallpaper.destroy();this.source.remove_effect(this.effect);this.effect.release();this.actor.destroy();
    }
}
