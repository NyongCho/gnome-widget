import Gio from 'gi://Gio';import GLib from 'gi://GLib';import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';import {capture,setScale} from './helpers.js';
export const METRICS={};
function check(ok,message){if(!ok)throw new Error(message);}
function luminance(color){const values=[color.red,color.green,color.blue].map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return values[0]*.2126+values[1]*.7152+values[2]*.0722;}
function blend(fg,bg){const a=fg.alpha/255;return {red:fg.red*a+bg.red*(1-a),green:fg.green*a+bg.green*(1-a),blue:fg.blue*a+bg.blue*(1-a),alpha:255};}
function contrast(fg,bg){const a=luminance(blend(fg,bg)),b=luminance(bg);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05);}
function textContrasts(actor,backdrop){
 const bg=actor instanceof St.Widget?blend(actor.get_theme_node().get_background_color(),backdrop):backdrop;
 const own=actor instanceof St.Label&&actor.get_text()? [{text:actor.get_text(),ratio:contrast(actor.get_theme_node().get_foreground_color(),bg)}]:[];
 return own.concat(actor.get_children().flatMap(child=>textContrasts(child,bg)));
}
export async function run(){
 Main.overview.hide();await Scripting.sleep(1500);const ext=Main.extensionManager.lookup('liquid-widgets@local');const settings=ext.stateObj.settings;const host=ext.stateObj.host;
 const background=new Gio.Settings({schema_id:'org.gnome.desktop.background'});const desktop=new Gio.Settings({schema_id:'org.gnome.desktop.interface'});
 const now=Date.now(),updatedAt=new Date(now).toISOString();host.setConnected(true);
 host.updateProvider('weather',{status:'ok',sourceId:'appearance-fixture',updatedAt,errorCode:null,data:{location:'서울 · 테스트',timeZone:'Asia/Seoul',current:{temperatureC:12,code:2},hourly:Array.from({length:6},(_,i)=>({at:new Date(now+(i+1)*3600000).toISOString(),temperatureC:10+i,precipitationProbability:i*10})),attributionUrl:'https://open-meteo.com/'}});
 host.updateProvider('network',{status:'ok',sourceId:'appearance-fixture',updatedAt,errorCode:null,data:{interface:'test0',rxBytesPerSec:1024,txBytesPerSec:512,history:[{at:new Date(now-1000).toISOString(),rx:100,tx:50},{at:updatedAt,rx:1024,tx:512}]}});
 const results=[];
 for(const [scheme,mode] of [['default','light'],['prefer-dark','dark'],['prefer-light','explicit-light']]){
  desktop.set_string('color-scheme',scheme);
  for(const [name,color,channel] of [['bright','#ffffff',255],['dark','#000000',0]]){
   const path=`${GLib.getenv('LIQUID_TEST_OUTPUT')}/${name}.svg`;GLib.file_set_contents(path,`<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800"><rect width="1280" height="800" fill="${color}"/></svg>`);
   background.set_string('picture-uri',Gio.File.new_for_path(path).get_uri());background.set_string('picture-uri-dark',Gio.File.new_for_path(path).get_uri());await Scripting.sleep(1200);
   for(const opacity of [.05,.24]){
    settings.set_double('opacity',opacity);await Scripting.sleep(150);
    const backdrop={red:channel,green:channel,blue:channel,alpha:255};
    const readings=[...host.cards.values()].flatMap(card=>textContrasts(card.button,backdrop));
    readings.push(...textContrasts(host.toolbar,backdrop));
    check(!host.toolbar.get_first_child().clutter_text.get_layout().is_ellipsized(),'brand name is clipped');
    const minimum=Math.min(...readings.map(r=>r.ratio));
    results.push({mode,background:name,opacity,minimum});
    if(opacity===.24)await capture(`widgets-${mode}-${name}`);
    print(`APPEARANCE_TEST: ${mode}/${name} tint=${opacity} minimumTextContrast=${minimum.toFixed(2)}`);
    check(minimum>=4.5,`${mode}/${name}: unreadable text ${JSON.stringify(readings.filter(r=>r.ratio<4.5))}`);
    const title=host.cards.get('calendar').title.get_theme_node().get_foreground_color();
    check(mode==='dark'?title.red>200:title.red<100,`${mode}: theme palette did not change`);
   }
  }
 }
 const wallpaper=Gio.File.new_for_path(`${GLib.getenv('LIQUID_TEST_OUTPUT')}/background.svg`).get_uri();
 background.set_string('picture-uri',wallpaper);background.set_string('picture-uri-dark',wallpaper);
 for(const [scheme,mode] of [['default','light'],['prefer-dark','dark']]){desktop.set_string('color-scheme',scheme);await Scripting.sleep(1200);await capture(`widgets-${mode}-wallpaper`);}
 desktop.set_string('color-scheme','default');await Scripting.sleep(150);
 // Typography must keep digit advances stable and fit AM/PM on a narrow display.
 const time=host.cards.get('clock').body.get_first_child();const widths=[];
 for(const value of ['00:00','11:11','23:59']){time.set_text(value);widths.push(time.get_preferred_width(-1)[1]);}
 check(Math.max(...widths)-Math.min(...widths)<=1,'clock digits change width as time advances');
 print('APPEARANCE_TEST: clockFont='+time.get_theme_node().get_font().to_string());
 for(const lang of ['ko','en']){
  settings.set_string('language',lang);host.layout({monitor:'primary',anchor:'top-right',offsetX:24,offsetY:20,scale:1,visible:settings.get_strv('visible')},{x:0,y:32,width:300,height:768},0);
  host.tick(Date.parse('2026-11-04T13:58:00Z'),'Asia/Seoul',true,'en-US',1);await Scripting.sleep(150);
  const clock=host.cards.get('clock'),label=clock.body.get_first_child();
  check(label.get_preferred_width(-1)[1]<=clock.button.width-36,`${lang}: narrow clock clips AM/PM (${label.get_preferred_width(-1)[1]} > ${clock.button.width-36})`);
  await capture(`clock-narrow-${lang}`);
 }
 settings.set_string('language','ko');desktop.set_string('color-scheme','prefer-dark');ext.stateObj.layout();await setScale(1.25);await capture('widgets-dark-125');
 GLib.file_set_contents(`${GLib.getenv('LIQUID_TEST_OUTPUT')}/contrast.json`,JSON.stringify(results,null,2));
 print('VISUAL_TEST: live light/dark mode, readable text on bright/dark wallpaper, tabular clock, narrow 12h clock and 125 percent passed');
}
