// THROWAWAY: Four clock faces inside the real GlassCard; synthetic frozen data.
// Run: ./scripts/test-gnome.py --clock-prototype
// No production clock rendering, live settings or user data is changed.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import Cairo from 'cairo';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import {capture} from './helpers.js';

export const METRICS={};
const names=['큰 디지털','사각 눈금','클래식 원형','미니멀 아날로그'];
const width=232,height=230;

function text(parent,value,x,y,w,h,size,weight=500,align='center'){
 const slot=new St.Widget({x,y,width:w,height:h,layout_manager:new Clutter.BinLayout()});
 const actor=new St.Label({text:value,x_align:align==='left'?Clutter.ActorAlign.START:Clutter.ActorAlign.CENTER,y_align:Clutter.ActorAlign.CENTER,
  style:`font-family:"Noto Sans Display";font-size:${size}px;font-weight:${weight};text-align:${align};`});
 actor.clutter_text.ellipsize=Pango.EllipsizeMode.NONE;
 actor.clutter_text.set_line_wrap(false);
 slot.add_child(actor);parent.add_child(slot);return actor;
}

function face(card,variant,dark){
 card.clear();card.title.get_parent().hide();card.status.hide();card.mode.hide();
 card.content.set_style('padding:18px;spacing:0;');card.body.y_expand=false;
 const frame=new St.Widget({width:196,height:194,layout_manager:new Clutter.FixedLayout()});
 const area=new St.DrawingArea({width:196,height:166});frame.add_child(area);
 const ink=dark?[.96,.97,.99]:[.075,.13,.21];
 area.connect('repaint',()=>{
  const cr=area.get_context();
  try{
   const cx=98,cy=82,radius=76;
   const color=(alpha=1)=>cr.setSourceRGBA(...ink,alpha);
   const line=(x1,y1,x2,y2,stroke,alpha=1)=>{color(alpha);cr.setLineWidth(stroke);cr.moveTo(x1,y1);cr.lineTo(x2,y2);cr.stroke();};
   cr.setLineCap(Cairo.LineCap.ROUND);
   if(variant===2||variant===3){
    color(dark?.055:.035);cr.arc(cx,cy,79,0,Math.PI*2);cr.fill();
   }
   for(let i=0;i<60;i++){
    const angle=i/60*Math.PI*2-Math.PI/2,major=i%5===0;
    if(variant===3&&!major)continue;
    const dx=Math.cos(angle),dy=Math.sin(angle);
    if(variant===0||variant===1){
     // Radial ticks intersect a softly inset rectangle rather than a circle.
     const distance=Math.min(88/Math.max(Math.abs(dx),.0001),74/Math.max(Math.abs(dy),.0001));
     const length=major?(variant===0?8:14):4;
     line(cx+dx*(distance-length),cy+dy*(distance-length),cx+dx*distance,cy+dy*distance,major?2.2:1.3,major?.85:.42);
    }else{
     const length=variant===3?12:major?8:3;
     line(cx+dx*(radius-length),cy+dy*(radius-length),cx+dx*radius,cy+dy*radius,variant===3?3:major?2:1,major?.9:.32);
    }
   }
   if(variant!==0){
    const hand=(angle,length,stroke)=>{
     const a=angle-Math.PI/2;
     line(cx-Math.cos(a)*6,cy-Math.sin(a)*6,cx+Math.cos(a)*length,cy+Math.sin(a)*length,stroke);
    };
    hand((10+8/60)/12*Math.PI*2,43,5.5);
    hand(8/60*Math.PI*2,62,3.7);
    // Fixed seconds value makes the sample comparable across all four faces.
    const a=38/60*Math.PI*2-Math.PI/2;
    cr.setSourceRGBA(dark?1:.8,dark?.65:.3,dark?.3:.055,1);cr.setLineWidth(1.4);
    cr.moveTo(cx-Math.cos(a)*10,cy-Math.sin(a)*10);cr.lineTo(cx+Math.cos(a)*67,cy+Math.sin(a)*67);cr.stroke();
    cr.arc(cx,cy,3.2,0,Math.PI*2);cr.fill();
   }
  }finally{cr.$dispose();}
 });
 if(variant===0){
  const time=text(frame,'10:08',8,41,180,84,62,600);
  const attrs=new Pango.AttrList();attrs.insert(Pango.attr_font_features_new('tnum=1'));
  attrs.insert(Pango.attr_stretch_new(Pango.Stretch.CONDENSED));time.clutter_text.set_attributes(attrs);
 }else if(variant===1){
  for(const [n,x,y] of [['12',82,17],['3',151,69],['6',82,120],['9',14,69]])text(frame,n,x,y,32,24,17,500);
 }else if(variant===2){
  for(let n=1;n<=12;n++){
   const a=n/12*Math.PI*2-Math.PI/2;
   text(frame,String(n),98+Math.cos(a)*57-12,82+Math.sin(a)*57-12,24,24,15,500);
  }
 }
 const date=text(frame,'11월 4일  수요일',0,174,196,20,13,500);
 date.opacity=220;card.body.add_child(frame);
}

function wallpaper(){
 const path=`${GLib.getenv('LIQUID_TEST_OUTPUT')}/clock-wallpaper.svg`;
 GLib.file_set_contents(path,`<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#263b68"/><stop offset=".45" stop-color="#877093"/><stop offset="1" stop-color="#81aaa8"/></linearGradient><linearGradient id="b" x2="1" y2="1"><stop stop-color="#efbbbc"/><stop offset="1" stop-color="#788eaf"/></linearGradient></defs><rect width="1280" height="800" fill="url(#g)"/><path d="M-200 780 C100 170 330 110 520 450 S950 1010 1500 450" fill="none" stroke="url(#b)" stroke-width="220"/><path d="M-100 950 C400 520 720 820 1420 70" fill="none" stroke="#bbd7cc" stroke-opacity=".25" stroke-width="150"/></svg>`);
 const settings=new Gio.Settings({schema_id:'org.gnome.desktop.background'}),uri=Gio.File.new_for_path(path).get_uri();
 settings.set_string('picture-uri',uri);settings.set_string('picture-uri-dark',uri);
}

export async function run(){
 Main.overview.hide();await Scripting.sleep(1000);
 const ext=Main.extensionManager.lookup('liquid-widgets@local').stateObj;
 ext.client.stop();ext.client=null;ext.clock.destroy();ext.clock=null;
 const host=ext.host,settings=ext.settings;
 settings.set_strv('visible',['clock','calendar','agenda','weather','system','network']);
 settings.reset('card-columns');settings.set_string('language','ko');settings.set_double('scale',1);
 settings.set_double('strength',12);settings.set_double('opacity',.24);
 const now=Date.parse('2026-11-04T01:08:38Z');host.tick(now,'Asia/Seoul',false,'ko-KR',1);host.setConnected(true);
 const wrap=data=>({status:'ok',sourceId:'clock-prototype',updatedAt:new Date(now).toISOString(),errorCode:null,data});
 host.updateProvider('calendar',wrap({month:'2026-11',timeZone:'Asia/Seoul',weekStart:1,events:[]}));
 host.updateProvider('weather',wrap({location:'서울특별시 · 대한민국',timeZone:'Asia/Seoul',current:{temperatureC:16,code:2},hourly:Array.from({length:6},(_,i)=>({at:new Date(now+(i+1)*3600000).toISOString(),temperatureC:16-i,precipitationProbability:10*i})),attributionUrl:'https://open-meteo.com/'}));
 host.updateProvider('system',wrap({cpuPercent:25,memoryUsedBytes:16*2**30,memoryTotalBytes:32*2**30,temperatureC:43}));
 host.updateProvider('network',wrap({interface:'test0',rxBytesPerSec:1024,txBytesPerSec:512,history:[]}));
 wallpaper();await Scripting.sleep(1200);
 const desktop=new Gio.Settings({schema_id:'org.gnome.desktop.interface'});
 const Card=host.cards.get('clock').constructor;
 const manifest={prototype:true,size:{width,height},time:'2026-11-04 10:08:38 Asia/Seoul',variants:names.map((name,i)=>({id:i+1,name})),screens:[]};
 for(const mode of ['dark','light']){
  const dark=mode==='dark';desktop.set_string('color-scheme',dark?'prefer-dark':'prefer-light');await Scripting.sleep(250);
  for(let i=0;i<4;i++){
   // Recreate the real layout, then replace only the clock's presentation.
   host.actor.show();ext.layout();await Scripting.sleep(80);
   face(host.cards.get('clock'),i,dark);await Scripting.sleep(150);
   const filename=`clock-${i+1}-${mode}`;await capture(filename);manifest.screens.push(filename+'.png');
  }
  host.actor.hide();
  const board=new St.Widget({style_class:`liquid-widgets liquid-${mode}`,x:0,y:0,width:1280,height:800});
  ext.layer.actor.add_child(board);
  const heading=text(board,'CLOCK STUDIES',132,154,1016,35,22,600,'left');heading.set_style(heading.get_style()+'color:#fff;letter-spacing:3px;');
  const sub=text(board,'같은 유리 · 같은 크기 · 같은 시간',132,197,1016,26,14,400,'left');sub.set_style(sub.get_style()+'color:#fff;');
  const cards=[];
  for(let i=0;i<4;i++){
   const card=new Card(`prototype-${i}`,0,names[i],()=>{});cards.push(card);board.add_child(card.surface.actor);
   const rect={x:132+i*260,y:270,width,height};card.setGeometry(rect,rect,1);card.setStyle(12,.24,false,dark,1);face(card,i,dark);
   const caption=text(board,`${i+1}  ${names[i]}`,rect.x,520,width,28,15,500);caption.set_style(caption.get_style()+'color:#fff;');
  }
  await Scripting.sleep(400);await capture(`clock-comparison-${mode}`);
  for(const card of cards)card.destroy();board.destroy();host.actor.show();
 }
 GLib.file_set_contents(`${GLib.getenv('LIQUID_TEST_OUTPUT')}/manifest.json`,JSON.stringify(manifest,null,2));
 print('CLOCK_PROTOTYPE: four native clock faces, eight applied desktops and two comparison boards captured');
}
