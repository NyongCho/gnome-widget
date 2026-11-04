import {translate,type Language} from '../shared/i18n.js';
import Clutter from 'gi://Clutter';import Gio from 'gi://Gio';import St from 'gi://St';
import type {NetworkData,SystemData,MediaData} from '../types.js';
import {rateLabel} from '../shared/liveData.js';import {GlassCard,label} from './card.js';
export function renderNetwork(card:GlassCard,data:NetworkData,scale:number,language:Language):void{
 card.title.set_text(`${translate(language,'네트워크')} · ${data.interface}`);
 card.body.add_child(label(`↓ ${rateLabel(data.rxBytesPerSec,language)}`,'liquid-network-rate'));
 card.body.add_child(label(`↑ ${rateLabel(data.txBytesPerSec,language)}`,'liquid-caption'));
 const graph=new St.DrawingArea({style_class:'liquid-network-graph',height:40*scale,x_expand:true,accessible_name:translate(language,'최근 60초 네트워크 속도 · 실선 다운로드, 점선 업로드')});
 graph.connect('repaint',()=>{
  const cr=graph.get_context();try{
   const [width,height]=graph.get_surface_size();const samples=data.history;if(samples.length<2)return;
   const maximum=Math.max(1,...samples.flatMap(s=>[s.rx,s.tx]));const end=Date.parse(samples.at(-1)!.at);
   const ink=graph.get_theme_node().get_foreground_color();
   for(const key of ['rx','tx'] as const){cr.setSourceRGBA(ink.red/255,ink.green/255,ink.blue/255,1);cr.setLineWidth(1.5*scale);cr.setDash(key==='tx'?[3*scale,3*scale]:[],0);
    samples.forEach((sample,i)=>{const x=Math.max(0,Math.min(1,(Date.parse(sample.at)-end+60000)/60000))*width;const y=height-2-(sample[key]/maximum)*(height-4);if(i===0)cr.moveTo(x,y);else cr.lineTo(x,y);});cr.stroke();
   }
  }finally{cr.$dispose();}
 });card.body.add_child(graph);
}
export function renderSystem(card:GlassCard,data:SystemData,language:Language):void{
 card.body.add_child(label(data.cpuPercent===null?translate(language,'CPU 측정 중'):`CPU  ${Math.round(data.cpuPercent)}%`,'liquid-value'));
 card.body.add_child(label(`RAM  ${(data.memoryUsedBytes/2**30).toFixed(1)} / ${(data.memoryTotalBytes/2**30).toFixed(1)} GiB`,'liquid-caption'));
 card.body.add_child(label(data.temperatureC===null?translate(language,'CPU 온도 센서 없음'):translate(language,'CPU 온도  {value}°C',{value:Math.round(data.temperatureC)}),'liquid-caption'));
}
export function renderMedia(card:GlassCard,data:MediaData,scale:number,language:Language):void{
 const row=new St.BoxLayout({style_class:'liquid-media-row',x_expand:true});
 const icon=new St.Icon({icon_name:'audio-x-generic-symbolic',icon_size:Math.round(44*scale),y_align:Clutter.ActorAlign.CENTER});
 // The service permits only readable bounded local files; never fetch artwork in Shell.
 if(data.artUri?.startsWith('file:///')){try{icon.gicon=new Gio.FileIcon({file:Gio.File.new_for_uri(data.artUri)});icon.fallback_icon_name='audio-x-generic-symbolic';}catch{}}
 row.add_child(icon);const details=new St.BoxLayout({orientation:Clutter.Orientation.VERTICAL,x_expand:true,y_align:Clutter.ActorAlign.CENTER});
 details.add_child(label(data.title||translate(language,'제목 없는 곡'),'liquid-media-title'));details.add_child(label(data.artist||translate(language,'아티스트 정보 없음'),'liquid-caption'));row.add_child(details);card.body.add_child(row);
}
