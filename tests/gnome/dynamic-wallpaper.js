import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import {capture} from './helpers.js';
export const METRICS={};
function check(ok,message){if(!ok)throw new Error(message);}
const chroma=rgb=>rgb.map(v=>v/Math.max(1,rgb.reduce((a,b)=>a+b,0)));
function mismatches(frame){
 const expected=chroma(frame.desktop);
 return Object.entries(frame.cards).filter(([,card])=>!card.active||card.textureBytes<=0||chroma(card.rgb).some((v,i)=>Math.abs(v-expected[i])>.04)).map(([id])=>id);
}
const output=GLib.getenv('LIQUID_TEST_OUTPUT');
function fixture(name,color){
 const image=GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB,false,8,64,64);
 image.fill(color);const path=`${output}/${name}.png`;image.savev(path,'png',[],[]);return path;
}
function read(name,host){
 const image=GdkPixbuf.Pixbuf.new_from_file(`${output}/${name}.png`),pixels=image.get_pixels(),stride=image.get_rowstride(),channels=image.get_n_channels(),scale=image.width/global.stage.width;
 const at=(x,y)=>{const i=Math.floor(y*scale)*stride+Math.floor(x*scale)*channels;return [...pixels.slice(i,i+3)];};
 return {desktop:at(400,400),cards:Object.fromEntries([...host.cards].map(([id,card])=>{
  const [x,y]=card.button.get_transformed_position();return[id,{rgb:at(x+card.button.width/2,y+card.button.height/2),active:card.surface.source.get_paint_visibility()&&!card.surface.fallback,...card.surface.diagnostics}];
 }))};
}
export async function run(){
 Main.overview.hide();await Scripting.sleep(1000);
 const ext=Main.extensionManager.lookup((GLib.getenv('LIQUID_TEST_UUID')||'liquid-widgets@local')).stateObj,host=ext.host,settings=ext.settings;
 ext.client.destroy();ext.client=null;ext.clock.destroy();ext.clock=null;
 settings.set_double('scale',.75);settings.set_double('opacity',.05);settings.set_strv('visible',['clock','calendar','agenda','weather','system','network','media']);
 new Gio.Settings({schema_id:'org.gnome.desktop.interface'}).set_string('color-scheme','prefer-dark');
 const clockNow=Date.parse('2026-11-05T01:00:00Z');host.tick(clockNow,'Asia/Seoul',false,'ko-KR',1);
 host.setConnected(true);host.updateProvider('media',{status:'ok',sourceId:'wallpaper-fixture',updatedAt:'2026-11-05T01:00:00Z',errorCode:null,data:{player:'org.mpris.MediaPlayer2.fixture',status:'playing',title:'Fixture',artist:'Fixture',artUri:null}});ext.layout();
 for(const card of host.cards.values())card.button.opacity=0;
 check(host.cards.size===7,'all seven cards must participate');
 const red=fixture('slide-red',0xa03050ff),green=fixture('slide-green',0x209080ff);
 const now=GLib.DateTime.new_now_local(),start=now.format('<year>%Y</year><month>%m</month><day>%d</day><hour>%H</hour><minute>%M</minute><second>%S</second>');
 const xml=`${output}/timed.xml`;
 GLib.file_set_contents(xml,`<background><starttime>${start}</starttime><static><duration>4</duration><file>${red}</file></static><transition><duration>4</duration><from>${red}</from><to>${green}</to></transition><static><duration>12</duration><file>${green}</file></static><transition><duration>4</duration><from>${green}</from><to>${red}</to></transition></background>`);
 const background=new Gio.Settings({schema_id:'org.gnome.desktop.background'}),uri=Gio.File.new_for_path(xml).get_uri();
 background.set_string('picture-options','stretched');background.set_string('picture-uri',uri);background.set_string('picture-uri-dark',uri);
 await Scripting.sleep(1500);await capture('dynamic-initial');const initial=read('dynamic-initial',host);
 check(initial.desktop[0]>initial.desktop[1]+40,'initial red slide did not load');
 check(!mismatches(initial).length,'cards did not load the first slide');
 check(Object.values(initial.cards).every(card=>card.active&&card.textureBytes>0),'a card is missing its GPU material');
 let final=null;const transition=[];
 for(let i=0;i<50;i++){
  await Scripting.sleep(200);await capture('dynamic-current');const current=read('dynamic-current',host);
  transition.push(current);
  if(current.desktop.every((v,i)=>Math.abs(v-[32,144,128][i])<=1)){final=current;break;}
 }
 check(final!==null,'GNOME did not advance the timed XML wallpaper');
 check(background.get_string('picture-uri')===uri,'the slideshow URI changed');
 await capture('dynamic-final');
 const report={initial,final,transition};GLib.file_set_contents(`${output}/dynamic.json`,JSON.stringify(report,null,2));
 const stale=mismatches(final);
 check(Object.entries(final.cards).every(([id,card])=>card.active&&card.textureBytes>0&&card.inputPaints>initial.cards[id].inputPaints&&card.blurPaints>initial.cards[id].blurPaints),'a card did not repaint its actual GPU material');
 print('DYNAMIC_WALLPAPER: '+JSON.stringify({initial,final}));
 check(!stale.length,`cards retained the old slide while desktop turned green: ${stale.join(', ')}`);
 check(transition.some(frame=>frame.desktop[0]>50&&frame.desktop[0]<140),'no intermediate crossfade frame was observed');
 check(transition.every(frame=>!mismatches(frame).length),'cards lagged behind an intermediate crossfade frame');
 // During a static slide, foreground/effect repaints must retain cached blur.
 await Scripting.sleep(300);const cached=Object.fromEntries([...host.cards].map(([id,c])=>[id,c.surface.diagnostics.blurPaints]));
 for(const strength of [0,20,16]){settings.set_double('strength',strength);await Scripting.sleep(60);}
 host.tick(clockNow+60000,'Asia/Seoul',false,'ko-KR',1);await Scripting.sleep(150);
 check([...host.cards].every(([id,c])=>c.surface.diagnostics.blurPaints===cached[id]),'static slide rebuilt blur for foreground/effect-only changes');
 // Hide through a whole XML cycle boundary, then ensure all cards catch up.
 host.actor.hide();
 for(let i=0;i<100;i++){
  await Scripting.sleep(200);await capture('dynamic-hidden');const current=read('dynamic-hidden',host);
  if(current.desktop[0]>current.desktop[1]+100)break;
  check(i<99,'slideshow did not return to red while hidden');
 }
 host.actor.show();await Scripting.sleep(150);await capture('dynamic-remapped');const remapped=read('dynamic-remapped',host);
 check(!mismatches(remapped).length,'remapped cards retained a hidden-period slide');
 report.remapped=remapped;GLib.file_set_contents(`${output}/dynamic.json`,JSON.stringify(report,null,2));
 print('DYNAMIC_WALLPAPER: all seven cards follow crossfade/endpoints, retain static cache and catch up after hiding');
}
