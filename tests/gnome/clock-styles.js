import Gio from 'gi://Gio';import GLib from 'gi://GLib';import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import {capture,setScale,findNamed} from './helpers.js';
export const METRICS={};
function check(ok,message){if(!ok)throw new Error(message);}
const styles=['digital','square','classic','minimal'];
const call=(method)=>new Promise((resolve,reject)=>Gio.DBus.session.call('org.local.LiquidCardOrderTest','/org/local/LiquidCardOrderTest','org.local.LiquidCardOrderTest1',method,null,null,Gio.DBusCallFlags.NONE,5000,null,(bus,result)=>{try{resolve(bus.call_finish(result).deep_unpack());}catch(e){reject(e);}}));
const state=async()=>JSON.parse((await call('State'))[0]);
async function until(predicate,message){for(let i=0;i<80;i++){if(await predicate())return;await Scripting.sleep(50);}throw new Error(message);}
export async function run(){
 Main.overview.hide();await Scripting.sleep(1000);
 const ext=Main.extensionManager.lookup('liquid-widgets@local').stateObj,host=ext.host,settings=ext.settings;
 ext.client.stop();ext.client=null;ext.clock.destroy();ext.clock=null;
 const child=Gio.Subprocess.new(['gjs','-m',GLib.getenv('LIQUID_TEST_CARD_ORDER')],Gio.SubprocessFlags.NONE);
 const keyboard=global.stage.get_context().get_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
 const key=async value=>{keyboard.notify_keyval(GLib.get_monotonic_time(),value,Clutter.KeyState.PRESSED);await Scripting.sleep(20);keyboard.notify_keyval(GLib.get_monotonic_time(),value,Clutter.KeyState.RELEASED);await Scripting.sleep(80);};
 try{
  await until(async()=>{try{return!!(await state()).rows;}catch{return false;}},'GTK did not open');
  check(Boolean((await state()).clockStyle),'preferences need a clock-style selector');
  check((await state()).clockStyle.value==='digital','large digital must be default');
  await until(()=>global.display.focus_window?.get_title()==='Liquid Card Order Keyboard Test','GTK did not receive focus');
  for(let i=0;i<4;i++){
   await call('FocusClock');await Scripting.sleep(150);await key(Clutter.KEY_Return);
   await until(async()=>(await state()).focus.some(name=>name.endsWith('Popover')),'clock choices did not open');
   await key(Clutter.KEY_Home);for(let j=0;j<i;j++)await key(Clutter.KEY_Down);await key(Clutter.KEY_Return);
   await until(async()=>(await state()).clockStyle.value===styles[i],'keyboard clock choice not saved');
   await until(()=>host.cards.get('clock').body.get_first_child().name===`liquid-clock-${styles[i]}`,'Shell did not update from preferences');
  }
  await capture('clock-settings-korean');
  settings.set_string('language','en');await Scripting.sleep(150);
  check((await state()).clockStyle.title==='Clock style','clock settings title did not translate');
  check((await state()).clockStyle.labels.join('|')==='Large digital|Square dial|Classic round|Minimal analog','style choices did not translate');
  check((await state()).clockStyle.value==='minimal','language change reset the style');
  await call('Reopen');await Scripting.sleep(200);check((await state()).clockStyle.selected===3,'reopening lost clock style');
  settings.set_string('clock-style','square');await Scripting.sleep(100);check((await state()).clockStyle.selected===1,'external clock style not reflected');
  await capture('clock-settings-english');
  print('CLOCK_PREFERENCES: all keyboard choices, live Shell updates, localization, external settings and reopening passed');
 }finally{keyboard.run_dispose();child.force_exit();}
 settings.set_string('language','ko');settings.set_strv('visible',['clock','calendar','agenda','weather','system','network']);
 const now=Date.parse('2026-11-04T01:08:38Z'),wrap=data=>({status:'ok',sourceId:'clock-styles-fixture',updatedAt:new Date(now).toISOString(),errorCode:null,data});
 host.setConnected(true);host.tick(now,'Asia/Seoul',false,'ko-KR',1);
 host.updateProvider('calendar',wrap({month:'2026-11',timeZone:'Asia/Seoul',weekStart:1,events:[]}));
 host.updateProvider('weather',wrap({location:'서울특별시 · 대한민국',timeZone:'Asia/Seoul',current:{temperatureC:16,code:2},hourly:Array.from({length:6},(_,i)=>({at:new Date(now+(i+1)*3600000).toISOString(),temperatureC:16-i,precipitationProbability:10*i})),attributionUrl:'https://open-meteo.com/'}));
 host.updateProvider('system',wrap({cpuPercent:25,memoryUsedBytes:16*2**30,memoryTotalBytes:32*2**30,temperatureC:43}));
 host.updateProvider('network',wrap({interface:'test0',rxBytesPerSec:1024,txBytesPerSec:512,history:[]}));
 const background=new Gio.Settings({schema_id:'org.gnome.desktop.background'}),desktop=new Gio.Settings({schema_id:'org.gnome.desktop.interface'});
 const path=`${GLib.getenv('LIQUID_TEST_OUTPUT')}/clock-wallpaper.svg`;
 GLib.file_set_contents(path,'<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#263b68"/><stop offset=".5" stop-color="#877093"/><stop offset="1" stop-color="#81aaa8"/></linearGradient></defs><rect width="1280" height="800" fill="url(#g)"/><path d="M-200 780 C100 170 330 110 520 450 S950 1010 1500 450" fill="none" stroke="#d5b1c3" stroke-width="200"/></svg>');
 const uri=Gio.File.new_for_path(path).get_uri();background.set_string('picture-uri',uri);background.set_string('picture-uri-dark',uri);await Scripting.sleep(900);
 const card=()=>host.cards.get('clock'),view=()=>host.clockFaces.get(card());
 const digit=()=>findNamed(card().body,'liquid-clock-digits');
 function fit(){
  const clock=card(),weather=host.cards.get('weather');
  check(clock.button.width===weather.button.width&&clock.button.height===weather.button.height,`clock/weather dimensions differ: ${JSON.stringify({scale:settings.get_double('scale'),style:settings.get_string('clock-style'),language:settings.get_string('language'),clock:[clock.button.width,clock.button.height],weather:[weather.button.width,weather.button.height],clockNatural:clock.content.get_preferred_height(clock.button.width),weatherNatural:weather.content.get_preferred_height(weather.button.width)})}`);
  const [x,y]=clock.body.get_transformed_position(),[w,h]=clock.body.get_transformed_size();
  const [fx,fy]=view().actor.get_transformed_position(),[fw,fh]=view().actor.get_transformed_size();
  check(fx>=x-1&&fy>=y-1&&fx+fw<=x+w+1&&fy+fh<=y+h+1,'clock face overflows its body');
  const [,dateY]=view().dateBox.get_transformed_position(),[,dateHeight]=view().dateBox.get_transformed_size();
  check(Math.abs(dateY+dateHeight-fy-fh)<=1,`clock date moved away from the allocated bottom: ${JSON.stringify({dateY,dateHeight,fy,fh,scale:settings.get_double('scale'),language:settings.get_string('language'),style:settings.get_string('clock-style')})}`);
  check(!digit().clutter_text.get_layout().is_ellipsized()&&digit().get_preferred_width(-1)[1]<=clock.button.width-34*settings.get_double('scale'),'digital digits clip');
 }
 for(const [scheme,mode] of [['prefer-dark','dark'],['prefer-light','light']]){
  desktop.set_string('color-scheme',scheme);
  for(const style of styles){settings.set_string('clock-style',style);host.tick(now,'Asia/Seoul',false,'ko-KR',1);await Scripting.sleep(150);fit();await capture(`clock-${style}-${mode}`);}
 }
 settings.set_string('clock-style','minimal');await Scripting.sleep(150);
 const face=view(),calendar=host.cards.get('calendar').body.get_first_child(),cached=card().surface.diagnostics.blurPaints;
 let paints=0;const repaint=face.area.connect('repaint',()=>paints++);const before=face.values.secondAngle;
 await Scripting.sleep(2200);check(paints>=2&&face.values.secondAngle!==before,'analog second hand did not advance');
 check(host.cards.get('calendar').body.get_first_child()===calendar,'analog seconds rebuilt the calendar');
 check(card().surface.diagnostics.blurPaints===cached,'analog seconds invalidated cached glass');face.area.disconnect(repaint);
 let oldTimer=face.timer;check(oldTimer>0,'analog has no timer');host.actor.hide();await Scripting.sleep(100);
 check(face.timer===0&&!GLib.MainContext.default().find_source_by_id(oldTimer),'unmapped analog left a timer');
 host.actor.show();await Scripting.sleep(100);check(face.timer>0,'remapped analog did not resume');
 settings.set_boolean('low-power',true);await Scripting.sleep(100);check(face.timer===0,'low power left the second timer');
 await capture('clock-low-power');settings.set_boolean('low-power',false);
 oldTimer=face.timer;settings.set_string('clock-style','digital');await Scripting.sleep(100);check(face.timer===0&&!GLib.MainContext.default().find_source_by_id(oldTimer),'digital retained an analog timer');
 for(const language of ['ko','en']){
  settings.set_string('language',language);
  for(const scale of Array.from({length:16},(_,i)=>(75+i*5)/100)){
   settings.set_double('scale',scale);
   for(const style of styles){settings.set_string('clock-style',style);host.tick(Date.parse('2026-11-03T15:00:00Z'),'Asia/Seoul',true,'en-US',1);await Scripting.sleep(60);fit();}
  }
  settings.set_string('clock-style','digital');await Scripting.sleep(80);
  check(digit().get_text()==='12:00','12h midnight should display 12:00');
  check(findNamed(card().body,'liquid-clock-period').get_text()===(language==='ko'?'오전':'AM'),'localized AM/PM missing');
 }
 settings.set_double('scale',1);settings.set_string('language','ko');host.tick(now,'Asia/Seoul',false,'ko-KR',1);
 for(const style of styles){settings.set_string('clock-style',style);host.layout({monitor:'primary',anchor:'top-right',offsetX:24,offsetY:20,scale:1,visible:settings.get_strv('visible')},{x:900,y:40,width:300,height:700},0);await Scripting.sleep(80);fit();}
 ext.layout();await setScale(1.25);await capture('clock-minimal-125');await setScale(1);
 card().surface.effect.ensureTarget=()=>{throw new Error('clock fixture allocation failure');};card().surface.effect.invalidate();
 await until(()=>card().mode.get_paint_visibility(),'clock fallback footer did not appear');
 check(!view().date.get_paint_visibility(),'clock fallback overlaps its date');await capture('clock-fallback');
 settings.set_string('clock-style','square');await Scripting.sleep(80);const removed=view();oldTimer=removed.timer;
 const visible=settings.get_strv('visible');settings.set_strv('visible',visible.filter(id=>id!=='clock'));await Scripting.sleep(100);
 check(removed.timer===0&&!GLib.MainContext.default().find_source_by_id(oldTimer),'removed clock leaked its timer');
 settings.set_strv('visible',visible);await Scripting.sleep(100);check(view()!==removed&&view().timer>0,'reenabled clock not restored');
 for(let i=0;i<5;i++){settings.set_string('clock-style','classic');await Scripting.sleep(30);const running=ext.host,clock=running.clockFaces.get(running.cards.get('clock')),timer=clock.timer;Main.extensionManager.disableExtension('liquid-widgets@local');await until(()=>!ext.host,'extension did not disable');check(clock.timer===0&&!GLib.MainContext.default().find_source_by_id(timer),'extension disable leaked clock timer');if(i<4){Main.extensionManager.enableExtension('liquid-widgets@local');await until(()=>ext.host?.cards.has('clock'),'extension did not enable');}}
 print('CLOCK_SHELL: four faces, time/locale/scale, second hand, stable actors/blur, mapped/low-power/style/removal/disable cleanup passed');
}
