// GNOME Shell private imports are isolated here; runtime target is GNOME 50.
import Clutter from 'gi://Clutter';
import * as Background from 'resource:///org/gnome/shell/ui/background.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
export interface Rect { x:number; y:number; width:number; height:number }
export class WallpaperClone {
    private manager: Background.BackgroundManager;
    private wallpaper = new Clutter.Actor();
    private changed: number;
    private loaded: number;
    private monitorsChanged: number;
    private rect: Rect = {x:0,y:0,width:1,height:1};
    constructor(container: Clutter.Actor, private monitorIndex:number, private padding:number, private invalidate:()=>void) {
        container.add_child(this.wallpaper);
        this.manager = new Background.BackgroundManager({container:this.wallpaper,monitorIndex,controlPosition:false,vignette:false});
        const update = () => { this.position(); this.invalidate(); };
        this.changed = this.manager.connect('changed',update);
        this.loaded = this.manager.connect('loaded',update);
        this.monitorsChanged = Main.layoutManager.connect('monitors-changed',update);
    }
    private position(): void {
        const monitor = Main.layoutManager.monitors[this.monitorIndex];
        if (!monitor || !this.manager.backgroundActor) return;
        // BackgroundActor uses its own allocation; position its wrapper.
        this.wallpaper.set_position(monitor.x-this.rect.x+this.padding, monitor.y-this.rect.y+this.padding);
        this.wallpaper.set_size(monitor.width,monitor.height);
    }
    setGeometry(rect:Rect):void { this.rect=rect; this.position(); this.invalidate(); }
    destroy():void { Main.layoutManager.disconnect(this.monitorsChanged); this.manager.disconnect(this.changed); this.manager.disconnect(this.loaded); this.manager.destroy(); this.wallpaper.destroy(); }
}
