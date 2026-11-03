import Gio from 'gi://Gio';import GLib from 'gi://GLib';import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';import {capture} from './helpers.js';
export const METRICS={};
function check(ok,message){if(!ok)throw new Error(message);}
const call=(method,args=null)=>new Promise((resolve,reject)=>Gio.DBus.session.call('org.local.LiquidPreferencesTest','/org/local/LiquidPreferencesTest','org.local.LiquidPreferencesTest1',method,args,null,Gio.DBusCallFlags.NONE,5000,null,(bus,result)=>{try{resolve(bus.call_finish(result).deep_unpack());}catch(e){reject(e);}}));
const state=async()=>JSON.parse((await call('State'))[0]);
const focus=async title=>{await call('Focus',new GLib.Variant('(s)',[title]));await Scripting.sleep(100);};
let keyboard;
async function key(value){keyboard.notify_keyval(GLib.get_monotonic_time(),value,Clutter.KeyState.PRESSED);await Scripting.sleep(20);keyboard.notify_keyval(GLib.get_monotonic_time(),value,Clutter.KeyState.RELEASED);await Scripting.sleep(50);}
async function type(text){for(const character of text)await key(character.codePointAt(0));}
async function waitFor(predicate,message){for(let i=0;i<60;i++){try{if(await predicate())return;}catch{}await Scripting.sleep(50);}throw new Error(message+': '+JSON.stringify(await state())+' shellFocus='+global.display.focus_window?.get_title());}
export async function run(){
 Main.overview.hide();await Scripting.sleep(1000);
 const child=Gio.Subprocess.new(['gjs','-m',GLib.getenv('LIQUID_TEST_PREFS')],Gio.SubprocessFlags.NONE);
 keyboard=global.stage.get_context().get_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
 try{
  await waitFor(async()=>!!(await state()).rows.length,'GTK preferences harness did not open');
  await waitFor(async()=>global.display.focus_window?.get_title()==='Liquid Widgets Keyboard Test','GTK window was not focused');
  await Scripting.sleep(200);
  const initial=await state();for(const title of ['모니터','기준 위치','가로 여백','세로 여백','네트워크 인터페이스'])check(initial.rows.includes(title),`missing preference: ${title}`);
  await focus('기준 위치');await key(Clutter.KEY_Return);await key(Clutter.KEY_Down);await key(Clutter.KEY_Return);await waitFor(async()=>(await state()).anchor==='top-left','keyboard anchor selection failed');
  await focus('가로 여백');await key(Clutter.KEY_Up);await waitFor(async()=>(await state()).offsetX===25,'keyboard margin adjustment failed');
  await focus('모니터');await key(Clutter.KEY_Return);await key(Clutter.KEY_Down);await key(Clutter.KEY_Return);await waitFor(async()=>(await state()).monitor!=='primary','keyboard monitor selection failed');
  await focus('네트워크 인터페이스');await key(Clutter.KEY_Return);await key(Clutter.KEY_Down);await key(Clutter.KEY_Return);await focus('저장');await key(Clutter.KEY_Return);await waitFor(async()=>(await state()).current.networkInterface!=='auto','keyboard NIC save failed');
  await focus('도시 이름');await type('Seoul');await key(Clutter.KEY_Return);await waitFor(async()=>(await state()).searches===1,'Enter did not search city');
  await focus('선택');await key(Clutter.KEY_Return);await waitFor(async()=>(await state()).current.weatherLocation?.id==='test-seoul','keyboard city selection failed');
  await focus('해제');await key(Clutter.KEY_Return);await waitFor(async()=>(await state()).current.weatherLocation===null,'keyboard city clear failed');
  await focus('비공개 iCal 주소');await type('invalid');await key(Clutter.KEY_Tab);const forward=(await state()).focus;await key(Clutter.KEY_ISO_Left_Tab);check(JSON.stringify((await state()).focus)!==JSON.stringify(forward),'Shift+Tab did not return focus');
  await focus('연결');await key(Clutter.KEY_Return);await waitFor(async()=>(await state()).messages.some(t=>t.includes('처리하지 못했어요')),'calendar error is not readable');check((await state()).calendarEmpty,'calendar input was not cleared');
  await focus('비공개 iCal 주소');await type('https://calendar.google.com/calendar/ical/test/public/basic.ics');await focus('연결');await key(Clutter.KEY_Return);await waitFor(async()=>(await state()).current.calendarEnabled,'calendar keyboard connect failed');check((await state()).calendarEmpty,'saved calendar input leaked');
  await focus('연결 해제');await key(Clutter.KEY_Return);await waitFor(async()=>!(await state()).current.calendarEnabled,'keyboard calendar clear failed');
  await capture('widgets-keyboard-preferences');
  print('PREFERENCES_TEST: actual GTK keyboard search/select/clear, secret submit/clear, error, Tab/Shift+Tab and placement/NIC controls passed');
 }finally{keyboard.run_dispose();child.force_exit();}
}
