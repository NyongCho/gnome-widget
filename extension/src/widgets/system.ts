import Cairo from 'cairo';
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import {translate,type Language} from '../shared/i18n.js';
import type {SystemData} from '../types.js';
import {GlassCard,label} from './card.js';

function gauge(name:string,percent:number|null,scale:number,language:Language):St.Widget{
    const ratio=percent===null?null:Math.max(0,Math.min(100,percent))/100;
    const value=ratio===null?'—':`${Math.round(ratio*100)}%`;
    const column=new St.BoxLayout({orientation:Clutter.Orientation.VERTICAL,
        style_class:'liquid-system-gauge',x_expand:true});
    const frame=new St.Widget({width:80*scale,height:80*scale,
        x_align:Clutter.ActorAlign.CENTER,layout_manager:new Clutter.BinLayout()});
    const ring=new St.DrawingArea({width:80*scale,height:80*scale,
        accessible_name:`${name} ${ratio===null?translate(language,'측정 중'):value}`});
    ring.connect('repaint',()=>{
        const cr=ring.get_context();
        try{
            const [width,height]=ring.get_surface_size(),size=Math.min(width,height);
            const stroke=size*7/80,radius=(size-stroke)/2-1*scale;
            const ink=ring.get_theme_node().get_foreground_color();
            cr.setLineWidth(stroke);cr.setLineCap(Cairo.LineCap.ROUND);
            cr.setSourceRGBA(ink.red/255,ink.green/255,ink.blue/255,.18);
            cr.arc(width/2,height/2,radius,0,2*Math.PI);cr.stroke();
            if(ratio!==null&&ratio>0){
                cr.setSourceRGBA(ink.red/255,ink.green/255,ink.blue/255,1);
                cr.arc(width/2,height/2,radius,-Math.PI/2,-Math.PI/2+2*Math.PI*ratio);cr.stroke();
            }
        }finally{cr.$dispose();}
    });
    const number=label(value,'liquid-system-percent');
    number.x_expand=false;number.x_align=Clutter.ActorAlign.CENTER;number.y_align=Clutter.ActorAlign.CENTER;
    frame.add_child(ring);frame.add_child(number);column.add_child(frame);
    const caption=label(name,'liquid-system-name');caption.x_align=Clutter.ActorAlign.CENTER;
    column.add_child(caption);return column;
}

export function renderSystem(card:GlassCard,data:SystemData,scale:number,language:Language):void{
    const row=new St.BoxLayout({style_class:'liquid-system-row',x_expand:true});
    row.add_child(gauge('CPU',data.cpuPercent,scale,language));
    row.add_child(gauge('RAM',data.memoryTotalBytes>0?data.memoryUsedBytes/data.memoryTotalBytes*100:null,scale,language));
    card.body.add_child(row);
    card.body.add_child(label(`RAM  ${(data.memoryUsedBytes/2**30).toFixed(1)} / ${(data.memoryTotalBytes/2**30).toFixed(1)} GiB`,'liquid-caption'));
    card.body.add_child(label(data.temperatureC===null?translate(language,'CPU 온도 센서 없음'):translate(language,'CPU 온도  {value}°C',{value:Math.round(data.temperatureC)}),'liquid-caption'));
}
