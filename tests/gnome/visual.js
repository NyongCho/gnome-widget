import Gio from 'gi://Gio';import GLib from 'gi://GLib';import St from 'gi://St';import GdkPixbuf from 'gi://GdkPixbuf';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';import {capture,setScale} from './helpers.js';
export const METRICS={};
function check(ok,message){if(!ok)throw new Error(message);}
function luminance(color){const values=[color.red,color.green,color.blue].map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return values[0]*.2126+values[1]*.7152+values[2]*.0722;}
function blend(fg,bg){const a=fg.alpha/255;return {red:fg.red*a+bg.red*(1-a),green:fg.green*a+bg.green*(1-a),blue:fg.blue*a+bg.blue*(1-a),alpha:255};}
function contrast(fg,bg){const a=luminance(blend(fg,bg)),b=luminance(bg);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05);}
function labels(actor){return (actor instanceof St.Label&&actor.get_text()?[actor]:[]).concat(actor.get_children().flatMap(labels));}
function bitmap(name){
 const image=GdkPixbuf.Pixbuf.new_from_file(`${GLib.getenv('LIQUID_TEST_OUTPUT')}/${name}.png`);
 const pixels=image.get_pixels(),stride=image.get_rowstride(),channels=image.get_n_channels();
 return {width:image.width,height:image.height,at(x,y){const i=y*stride+x*channels;return{red:pixels[i],green:pixels[i+1],blue:pixels[i+2],alpha:255};}};
}
async function renderedContrasts(host,name){
 // Read the real GPU material, not a guessed CSS background. Hide only glyphs
 // so labels such as today's filled calendar cell retain their backgrounds.
 const actors=labels(host.actor).filter(actor=>actor.get_paint_visibility());await capture(name);
 const visible=bitmap(name);
 for(const actor of actors)actor.clutter_text.opacity=0;
 await Scripting.sleep(40);await capture(`${name}-material`);
 const material=bitmap(`${name}-material`);
 for(const actor of actors)actor.clutter_text.opacity=255;
 const scale=visible.width/global.stage.width,readings=[];
 for(const actor of actors){
  const fg=actor.get_theme_node().get_foreground_color(),[x,y]=actor.get_transformed_position(),[w,h]=actor.get_transformed_size();
  let minimum=Infinity,samples=0;
  for(let py=Math.max(0,Math.ceil(y*scale));py<Math.min(visible.height,Math.floor((y+h)*scale));py++)for(let px=Math.max(0,Math.ceil(x*scale));px<Math.min(visible.width,Math.floor((x+w)*scale));px++){
   const ink=visible.at(px,py),bg=material.at(px,py);
   const changed=Math.max(Math.abs(ink.red-bg.red),Math.abs(ink.green-bg.green),Math.abs(ink.blue-bg.blue))>2;
   if(changed){minimum=Math.min(minimum,contrast(fg,bg));samples++;}
  }
  const withinScreen=x>=0&&y>=0&&(x+w)*scale<=visible.width&&(y+h)*scale<=visible.height;
  check(samples>0||!withinScreen,`no readable glyph samples: ${actor.get_text()}`);
  if(samples)readings.push({text:actor.get_text(),ratio:minimum,samples});
 }
 check(readings.length>15,'too few visible glyphs to verify material contrast');
 return readings;
}
export async function run(){
 Main.overview.hide();await Scripting.sleep(1500);const ext=Main.extensionManager.lookup('liquid-widgets@local');const settings=ext.stateObj.settings;const host=ext.stateObj.host;
 const background=new Gio.Settings({schema_id:'org.gnome.desktop.background'});const desktop=new Gio.Settings({schema_id:'org.gnome.desktop.interface'});
 const now=Date.now(),updatedAt=new Date(now).toISOString();host.setConnected(true);
 const surface=host.cards.get('clock').surface;
 const initial=surface.diagnostics;
 check(initial.blurPaints>=2,'wallpaper has no cached two-pass blur');
 settings.set_double('strength',7);await Scripting.sleep(150);
 check(surface.diagnostics.blurPaints===initial.blurPaints,'strength changes unnecessarily rebuild blur');
 settings.set_double('opacity',.4);await Scripting.sleep(150);
 check(surface.diagnostics.blurPaints===initial.blurPaints,'tone changes unnecessarily rebuild blur');
 surface.setEnabled(false);check(surface.diagnostics.textureBytes===0,'low power retains GPU targets');
 surface.setEnabled(true);await Scripting.sleep(150);
 check(surface.diagnostics.blurPaints>initial.blurPaints,'re-enabling did not regenerate released blur');
 settings.set_double('strength',12);
 host.updateProvider('weather',{status:'ok',sourceId:'appearance-fixture',updatedAt,errorCode:null,data:{location:'서울 · 테스트',timeZone:'Asia/Seoul',current:{temperatureC:12,code:2},hourly:Array.from({length:6},(_,i)=>({at:new Date(now+(i+1)*3600000).toISOString(),temperatureC:10+i,precipitationProbability:i*10})),attributionUrl:'https://open-meteo.com/'}});
 host.updateProvider('network',{status:'ok',sourceId:'appearance-fixture',updatedAt,errorCode:null,data:{interface:'test0',rxBytesPerSec:1024,txBytesPerSec:512,history:[{at:new Date(now-1000).toISOString(),rx:100,tx:50},{at:updatedAt,rx:1024,tx:512}]}});
 const results=[];
 for(const [scheme,mode] of [['default','light'],['prefer-dark','dark'],['prefer-light','explicit-light']]){
  desktop.set_string('color-scheme',scheme);
  for(const [name,color] of [['bright','#ffffff'],['dark','#000000']]){
   const path=`${GLib.getenv('LIQUID_TEST_OUTPUT')}/${name}.svg`;GLib.file_set_contents(path,`<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800"><rect width="1280" height="800" fill="${color}"/></svg>`);
   background.set_string('picture-uri',Gio.File.new_for_path(path).get_uri());background.set_string('picture-uri-dark',Gio.File.new_for_path(path).get_uri());await Scripting.sleep(1200);
   for(const opacity of [.05,.24]){
    settings.set_double('opacity',opacity);await Scripting.sleep(150);
    const readings=await renderedContrasts(host,`widgets-${mode}-${name}-${opacity}`);
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
 const oldPaints=surface.diagnostics.inputPaints;
 background.set_string('picture-uri',wallpaper);background.set_string('picture-uri-dark',wallpaper);
 for(const [scheme,mode] of [['default','light'],['prefer-dark','dark']]){desktop.set_string('color-scheme',scheme);await Scripting.sleep(1200);const readings=await renderedContrasts(host,`widgets-${mode}-wallpaper`);check(Math.min(...readings.map(r=>r.ratio))>=4.5,`${mode}: wallpaper text contrast`);}
 check(surface.diagnostics.inputPaints>oldPaints,'wallpaper changes leave stale cached material');
 const cached=surface.diagnostics.blurPaints;
 settings.set_double('strength',0);await Scripting.sleep(100);await renderedContrasts(host,'material-refraction-off');
 settings.set_double('strength',20);await Scripting.sleep(100);await renderedContrasts(host,'material-refraction-on');
 const off=bitmap('material-refraction-off-material'),on=bitmap('material-refraction-on-material');
 const button=host.cards.get('clock').button,[cx,cy]=button.get_transformed_position();let edgeChanges=0,centerChanges=0;
 for(let y=Math.ceil(cy);y<Math.floor(cy+button.height);y++)for(let x=Math.ceil(cx);x<Math.floor(cx+button.width);x++){
  const a=off.at(x,y),b=on.at(x,y);if(Math.max(Math.abs(a.red-b.red),Math.abs(a.green-b.green),Math.abs(a.blue-b.blue))<=2)continue;
  if(x<cx+24||x>cx+button.width-24||y<cy+24||y>cy+button.height-24)edgeChanges++;else centerChanges++;
 }
 check(edgeChanges>30&&centerChanges===0,`lens should change the rim and keep the center still: ${edgeChanges}/${centerChanges}`);
 check(surface.diagnostics.blurPaints===cached,'strength setting discarded cached blur');
 print(`MATERIAL_TEST: rim pixels changed=${edgeChanges}, center=${centerChanges}, blur passes=${cached}`);
 settings.set_double('strength',12);
 const referencePath=`${GLib.getenv('LIQUID_TEST_OUTPUT')}/reference-gradient.svg`;
 GLib.file_set_contents(referencePath,'<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800"><defs><linearGradient id="g" x2=".4" y2="1"><stop stop-color="#51487e"/><stop offset=".5" stop-color="#79598d"/><stop offset="1" stop-color="#af7a94"/></linearGradient></defs><rect width="1280" height="800" fill="url(#g)"/></svg>');
 const reference=Gio.File.new_for_path(referencePath).get_uri();background.set_string('picture-uri',reference);background.set_string('picture-uri-dark',reference);
 for(const [scheme,mode] of [['default','light'],['prefer-dark','dark']]){
  desktop.set_string('color-scheme',scheme);await Scripting.sleep(1200);
  const readings=await renderedContrasts(host,`widgets-${mode}-reference`);
  check(Math.min(...readings.map(r=>r.ratio))>=4.5,`${mode}: reference background contrast`);
  settings.set_boolean('low-power',true);await Scripting.sleep(150);
  check([...host.cards.values()].every(card=>card.surface.diagnostics.textureBytes===0),'low power retained a target');
  const fallbackReadings=await renderedContrasts(host,`widgets-${mode}-low-power`);
  check(Math.min(...fallbackReadings.map(r=>r.ratio))>=4.5,`${mode}: low-power contrast`);
  settings.set_boolean('low-power',false);await Scripting.sleep(150);
 }
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
 settings.set_string('language','ko');desktop.set_string('color-scheme','prefer-dark');ext.stateObj.layout();await setScale(1.25);
 const fractional=await renderedContrasts(host,'widgets-dark-125');check(Math.min(...fractional.map(r=>r.ratio))>=4.5,'125% material contrast');
 GLib.file_set_contents(`${GLib.getenv('LIQUID_TEST_OUTPUT')}/contrast.json`,JSON.stringify(results,null,2));
 print('VISUAL_TEST: live light/dark mode, readable text on bright/dark wallpaper, tabular clock, narrow 12h clock and 125 percent passed');
}
