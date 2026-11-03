import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
export class DesktopLayerAdapter {
    readonly actor = new Clutter.Actor({reactive:false});
    private restacked: number;
    private sessionChanged: number;
    private overviewShowing: number;
    private overviewHidden: number;
    constructor() {
        global.window_group.add_child(this.actor);
        this.restacked = global.display.connect('restacked',()=>this.restack());
        this.sessionChanged = Main.sessionMode.connect('updated',()=>this.updateVisibility());
        this.overviewShowing = Main.overview.connect('showing',()=>this.actor.hide());
        this.overviewHidden = Main.overview.connect('hidden',()=>this.updateVisibility());
        this.restack(); this.updateVisibility();
    }
    private restack():void {
        // DING filters itself out of global.get_window_actors(). Inspect actual stack.
        const children = global.window_group.get_children();
        const desktop = children.filter((actor): actor is Meta.WindowActor => {
            if (!(actor instanceof Meta.WindowActor)) return false;
            const win = actor.meta_window;
            return win?.get_window_type() === Meta.WindowType.DESKTOP || win?.get_gtk_application_id() === 'com.rastersoft.ding';
        });
        const topDesktop = children.filter(child=>desktop.includes(child as Meta.WindowActor)).at(-1);
        if (topDesktop) global.window_group.set_child_above_sibling(this.actor,topDesktop);
        else {
            const firstWindow = children.find(child => child instanceof Meta.WindowActor);
            if (firstWindow) global.window_group.set_child_below_sibling(this.actor,firstWindow);
            else global.window_group.set_child_above_sibling(this.actor,null);
        }
    }
    private updateVisibility():void { this.actor.visible = !Main.sessionMode.isLocked && !Main.overview.visible; }
    destroy():void {
        global.display.disconnect(this.restacked);
        Main.sessionMode.disconnect(this.sessionChanged);
        Main.overview.disconnect(this.overviewShowing);
        Main.overview.disconnect(this.overviewHidden);
        this.actor.destroy();
    }
}
