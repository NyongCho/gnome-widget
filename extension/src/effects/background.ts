import Clutter from 'gi://Clutter';
import {GlassEffect} from './glass.js';
import {WallpaperClone, type Rect} from '../platform/gnome50.js';
export class GlassSurface {
    readonly actor = new Clutter.Actor();
    private source = new Clutter.Actor({clip_to_allocation:true});
    private effect = new GlassEffect();
    private wallpaper: WallpaperClone;
    constructor(monitorIndex:number) {
        this.actor.add_child(this.source);
        this.source.add_effect(this.effect);
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
    setEnabled(enabled:boolean):void { this.source.visible=enabled; if(!enabled)this.effect.release(); }
    setStrength(value:number):void { this.effect.setStrength(value); }
    get diagnostics():object { return {inputPaints:this.effect.inputPaints,outputPaints:this.effect.outputPaints,textureBytes:this.effect.textureBytes}; }
    destroy():void { this.wallpaper.destroy(); this.source.remove_effect(this.effect); this.effect.release(); this.actor.destroy(); }
}
