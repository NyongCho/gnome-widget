import Cairo from 'cairo';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';
import {clockFaceValues,millisecondsToNextSecond,type ClockStyle} from '../shared/clockValues.js';
import type {GlassCard} from './card.js';

interface FaceOptions{style:ClockStyle;zone:string;hour12:boolean;locale:string;scale:number;width:number;lowPower:boolean}
function slot(child:St.Widget):St.Widget{
    const box=new St.Widget({layout_manager:new Clutter.BinLayout()});
    child.x_align=Clutter.ActorAlign.CENTER;child.y_align=Clutter.ActorAlign.CENTER;
    box.add_child(child);return box;
}
function text(name:string):St.Label{
    const actor=new St.Label({name});actor.clutter_text.ellipsize=Pango.EllipsizeMode.NONE;return actor;
}

/** A clock owns its second timer and foreground. Minute ticks never recreate it. */
export class ClockFace{
    readonly actor=new St.Widget({name:'liquid-clock-face',layout_manager:new Clutter.FixedLayout(),y_expand:true});
    private area=new St.DrawingArea({name:'liquid-clock-dial'});
    private digits=text('liquid-clock-digits');private date=text('liquid-clock-date');private period=text('liquid-clock-period');
    private digitsBox=slot(this.digits);private dateBox=slot(this.date);private periodBox=slot(this.period);
    private numbers=Array.from({length:12},(_,i)=>{const label=text('liquid-clock-hour');label.set_text(String(i+1));return{label,box:slot(label)};});
    private options:FaceOptions|null=null;
    private values=clockFaceValues(Date.now(),'UTC',false,'en-US');
    private unit=1;private offset=0;private timer=0;
    constructor(private card:GlassCard,private readNow:()=>number){
        this.actor.add_child(this.area);
        for(const number of this.numbers)this.actor.add_child(number.box);
        for(const box of [this.digitsBox,this.periodBox,this.dateBox])this.actor.add_child(box);
        // Keep fallback messaging in the date footer without adding empty space.
        const heading=card.title.get_parent();heading?.remove_child(card.mode);heading?.hide();
        card.mode.x_align=Clutter.ActorAlign.CENTER;card.mode.y_align=Clutter.ActorAlign.CENTER;
        this.dateBox.add_child(card.mode);
        card.mode.connect('notify::visible',()=>{this.date.visible=!card.mode.visible;});
        card.content.set_style('spacing:0;');card.body.y_expand=true;card.body.add_child(this.actor);
        const attrs=new Pango.AttrList();attrs.insert(Pango.attr_font_features_new('tnum=1'));
        attrs.insert(Pango.attr_stretch_new(Pango.Stretch.CONDENSED));this.digits.clutter_text.set_attributes(attrs);
        this.area.connect('repaint',()=>this.paint());
        this.actor.connect('notify::height',()=>this.placeFooter());
        this.actor.connect('notify::mapped',()=>this.schedule());
        this.actor.connect('destroy',()=>this.stop());
    }
    update(options:FaceOptions):void{
        this.options=options;this.actor.name=`liquid-clock-${options.style}`;
        this.unit=Math.min(options.scale,Math.max(1,options.width)/196);this.offset=(options.width-196*this.unit)/2;
        const u=this.unit,x=this.offset;
        // Minimum: dial through 161, five-pixel gap, 18-pixel date. The body
        // expands to the weather-matched allocation and pins the date below.
        this.actor.set_size(options.width,184*u);this.area.set_size(options.width,166*u);
        const place=(box:St.Widget,px:number,y:number,w:number,h:number)=>{box.set_position(x+px*u,y*u);box.set_size(w*u,h*u);};
        place(this.digitsBox,8,41,180,84);place(this.periodBox,8,126,180,22);place(this.dateBox,0,166,196,18);this.placeFooter();
        this.digits.set_style(`font-family:"Noto Sans Display";font-size:${62*u}px;font-weight:600;`);
        this.date.set_style(`font-size:${13*u}px;font-weight:500;`);this.period.set_style(`font-size:${12*u}px;font-weight:500;`);
        this.digitsBox.visible=options.style==='digital';this.periodBox.visible=options.style==='digital'&&options.hour12;
        this.date.visible=!this.card.mode.visible;
        for(let i=0;i<12;i++){
            const number=this.numbers[i]!,n=i+1,a=n/12*Math.PI*2-Math.PI/2;
            number.box.visible=options.style==='classic'||options.style==='square'&&n%3===0;
            let px=98+Math.cos(a)*57-12,py=82+Math.sin(a)*57-12;
            if(options.style==='square'){
                const points:Record<number,[number,number]>={12:[86,17],3:[154,70],6:[86,120],9:[24,70]};
                [px,py]=points[n]??[0,0];
            }
            place(number.box,px,py,24,24);number.label.set_style(`font-size:${(options.style==='square'?17:15)*u}px;font-weight:500;`);
        }
        this.refresh();
        const natural=this.digits.get_preferred_width(-1)[1],available=180*u;
        if(natural>available)this.digits.set_style(`font-family:"Noto Sans Display";font-size:${Math.max(1,62*u*(available-2)/natural)}px;font-weight:600;`);
        this.schedule();
    }
    private refresh():void{
        if(!this.options)return;
        const {zone,hour12,locale}=this.options;this.values=clockFaceValues(this.readNow(),zone,hour12,locale);
        this.digits.set_text(this.values.digits);this.period.set_text(this.values.dayPeriod);this.date.set_text(this.values.date);
        this.card.button.accessible_name=`${this.values.date} · ${this.values.dayPeriod} ${this.values.digits}`.trim();
        this.area.queue_repaint();
    }
    private stop():void{if(this.timer){GLib.Source.remove(this.timer);this.timer=0;}}
    private placeFooter():void{this.dateBox.set_y(Math.max(166*this.unit,this.actor.height-18*this.unit));}
    private schedule():void{
        this.stop();
        if(!this.options||this.options.style==='digital'||this.options.lowPower||!this.actor.mapped)return;
        this.refresh();
        this.timer=GLib.timeout_add(GLib.PRIORITY_DEFAULT,millisecondsToNextSecond(this.readNow()),()=>{
            this.timer=0;this.schedule();return GLib.SOURCE_REMOVE;
        });
    }
    private paint():void{
        if(!this.options)return;
        const cr=this.area.get_context(),u=this.unit,cx=this.offset+98*u,cy=82*u;
        const {style,lowPower}=this.options;
        try{
            const ink=this.area.get_theme_node().get_foreground_color();
            const color=(alpha=1)=>cr.setSourceRGBA(ink.red/255,ink.green/255,ink.blue/255,alpha);
            const line=(x1:number,y1:number,x2:number,y2:number,width:number,alpha=1)=>{
                color(alpha);cr.setLineWidth(width*u);cr.moveTo(x1,y1);cr.lineTo(x2,y2);cr.stroke();
            };
            cr.setLineCap(Cairo.LineCap.ROUND);
            if(style==='classic'||style==='minimal'){color(.055);cr.arc(cx,cy,79*u,0,Math.PI*2);cr.fill();}
            for(let i=0;i<60;i++){
                const a=i/60*Math.PI*2-Math.PI/2,major=i%5===0,dx=Math.cos(a),dy=Math.sin(a);
                if(style==='minimal'&&!major)continue;
                const square=style==='digital'||style==='square';
                const outer=square?Math.min(88/Math.max(Math.abs(dx),.0001),74/Math.max(Math.abs(dy),.0001)):76;
                const length=square?(major?(style==='digital'?8:14):4):(style==='minimal'?12:major?8:3);
                line(cx+dx*(outer-length)*u,cy+dy*(outer-length)*u,cx+dx*outer*u,cy+dy*outer*u,
                    style==='minimal'?3:major?2.2:1.3,major?.9:.38);
            }
            if(style!=='digital'){
                const hand=(degrees:number,length:number,width:number)=>{
                    const a=degrees*Math.PI/180-Math.PI/2;
                    line(cx-Math.cos(a)*6*u,cy-Math.sin(a)*6*u,cx+Math.cos(a)*length*u,cy+Math.sin(a)*length*u,width);
                };
                hand(this.values.hourAngle,43,5.5);hand(this.values.minuteAngle,62,3.7);
                if(!lowPower){
                    const dark=ink.red>128,a=this.values.secondAngle*Math.PI/180-Math.PI/2;
                    cr.setSourceRGBA(dark?1:.8,dark?.65:.3,dark?.3:.055,1);cr.setLineWidth(1.4*u);
                    cr.moveTo(cx-Math.cos(a)*10*u,cy-Math.sin(a)*10*u);cr.lineTo(cx+Math.cos(a)*67*u,cy+Math.sin(a)*67*u);cr.stroke();
                }
                cr.arc(cx,cy,3.2*u,0,Math.PI*2);cr.fill();
            }
        }finally{cr.$dispose();}
    }
}
