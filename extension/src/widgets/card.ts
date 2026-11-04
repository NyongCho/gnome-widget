import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import {GlassSurface} from '../effects/background.js';
import type {Rect} from '../shared/layout.js';
export function label(text:string,styleClass='liquid-caption'):St.Label{
    const actor=new St.Label({text,style_class:styleClass,x_expand:true});
    actor.clutter_text.ellipsize=Pango.EllipsizeMode.END;
    return actor;
}
export class GlassCard {
    private scale=1;
    private opacity=.24;private lowPower=false;
    readonly surface:GlassSurface;
    readonly button:St.Button;
    readonly content=new St.BoxLayout({orientation:Clutter.Orientation.VERTICAL,style_class:'liquid-content',x_expand:true,y_expand:true,x_align:Clutter.ActorAlign.FILL,y_align:Clutter.ActorAlign.FILL});
    readonly body=new St.BoxLayout({orientation:Clutter.Orientation.VERTICAL,style_class:'liquid-body',y_expand:true});
    readonly title:St.Label;
    readonly status=label('','liquid-status');
    readonly mode=label('','liquid-status');
    constructor(readonly id:string,monitor:number,title:string,action:()=>void){
        this.surface=new GlassSurface(monitor,()=>this.applyAppearance());
        this.title=label(title,'liquid-title');
        const heading=new St.BoxLayout({x_expand:true});
        heading.add_child(this.title);this.mode.x_expand=false;this.mode.x_align=Clutter.ActorAlign.END;this.mode.hide();heading.add_child(this.mode);
        this.content.add_child(heading);this.content.add_child(this.body);this.content.add_child(this.status);
        this.button=new St.Button({child:this.content,reactive:true,can_focus:true,track_hover:true,style_class:'liquid-card',accessible_name:title});
        this.button.connect('clicked',action);this.surface.actor.add_child(this.button);
    }
    setGeometry(local:Rect,world:Rect,scale:number):void{
        this.surface.setGeometry(local,scale,world);
        this.scale=scale;this.button.set_size(local.width,local.height);
    }
    setStyle(strength:number,opacity:number,lowPower:boolean):void{
        this.opacity=opacity;this.lowPower=lowPower;
        this.surface.setStrength(strength);this.surface.setEnabled(!lowPower);this.applyAppearance();
    }
    private applyAppearance():void{
        this.mode.visible=this.surface.fallback;
        this.button.set_style(`font-size:${14*this.scale}px;background-color:rgba(12,24,42,${this.lowPower||this.surface.fallback?Math.max(.72,this.opacity):this.opacity});`);
    }
    clear():void{this.body.destroy_all_children();}
    destroy():void{this.surface.destroy();}
}
