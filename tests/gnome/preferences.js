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
async function selectLanguage(value){
 await focus('언어 / Language');await key(Clutter.KEY_Return);
 await waitFor(async()=>(await state()).focus.includes('Gtk_Popover'),'language choices did not open');
 await key(value==='en'?Clutter.KEY_End:Clutter.KEY_Home);
 await waitFor(async()=>(await state()).choiceFocus.includes(value==='en'?'English':'한국어'),'language choice did not receive focus');
 await key(Clutter.KEY_Return);
 await waitFor(async()=>(await state()).language===value,'language preference was not saved');
}
export async function run(){
 Main.overview.hide();await Scripting.sleep(1000);
 const isPublic=GLib.getenv('LIQUID_TEST_EDITION')==='gjs';
 if(isPublic){const uuid=GLib.getenv('LIQUID_TEST_UUID');Main.extensionManager.disableExtension(uuid);for(let i=0;i<100&&Main.extensionManager.lookup(uuid).state!==2;i++)await Scripting.sleep(20);}
 const child=Gio.Subprocess.new(['gjs','-m',GLib.getenv('LIQUID_TEST_PREFS')],Gio.SubprocessFlags.NONE);
 keyboard=global.stage.get_context().get_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
 try{
  await waitFor(async()=>!!(await state()).rows.length,'GTK preferences harness did not open');
  await waitFor(async()=>global.display.focus_window?.get_title()==='Liquid Widgets Keyboard Test','GTK window was not focused');
  await Scripting.sleep(200);
  const initial=await state();for(const title of ['모니터','기준 위치','가로 여백','세로 여백','네트워크 인터페이스'])check(initial.rows.includes(title),`missing preference: ${title}`);
  check(initial.rows.includes('언어 / Language'),'language selector is missing');
  await focus('비공개 iCal 주소');await type('https://calendar.google.com/calendar/ical/draft/public/basic.ics');
  await focus('도시 이름');await type('Seoul');
  await selectLanguage('en');
  await waitFor(async()=>(await state()).language==='en'&&(await state()).rows.includes('Private iCal address'),'English selection did not translate existing preferences');
  check((await state()).calendarDraftRetained&&(await state()).city==='Seoul','language switch erased an input draft');
  await capture('preferences-english');
  await selectLanguage('ko');
  await waitFor(async()=>(await state()).language==='ko'&&(await state()).rows.includes('비공개 iCal 주소'),'Korean selection did not translate existing preferences');
  check((await state()).calendarDraftRetained&&(await state()).city==='Seoul','return to Korean erased an input draft');
  check((await state()).subscriptions===1,'language switches duplicated calendar subscriptions');
  await capture('preferences-korean');
  await focus('비공개 iCal 주소');await key(Clutter.KEY_Home);for(let i=0;i<70;i++)await key(Clutter.KEY_Delete);
  await focus('도시 이름');await key(Clutter.KEY_Home);for(let i=0;i<5;i++)await key(Clutter.KEY_Delete);
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
  await waitFor(async()=>(await state()).messages.some(t=>t.includes('데이터를 읽을 수 없어요')),'actual sync failure not shown');
  await call('CalendarStatus',new GLib.Variant('(s)',['ok']));
  await waitFor(async()=>(await state()).messages.some(t=>t.includes(isPublic?'연결 확인 완료':'동기화 완료')),'sync completion did not replace waiting text');
  await call('ScrollTop');await Scripting.sleep(150);await capture('widgets-calendar-sync-state');
  if(isPublic){await call('CalendarStatus',new GLib.Variant('(s)',['stale']));await waitFor(async()=>(await state()).messages.some(t=>t.includes('마지막 확인 데이터')),'preview stale state lost last-good data');await call('ScrollTop');await Scripting.sleep(150);await capture('preferences-public-stale');}
  await focus('연결 해제');await key(Clutter.KEY_Return);await waitFor(async()=>!(await state()).current.calendarEnabled,'keyboard calendar clear failed');
  await capture('widgets-keyboard-preferences');
  // A response arriving after the language switch uses the new language.
  await focus('도시 이름');await key(Clutter.KEY_Home);for(let i=0;i<5;i++)await key(Clutter.KEY_Delete);await type('Delayed');await key(Clutter.KEY_Return);
  await waitFor(async()=>(await state()).pendingSearch,'delayed city search did not start');
  await selectLanguage('en');
  await call('CompleteSearch');
  await waitFor(async()=>(await state()).messages.includes('Select a city to display.'),'delayed response used the old language');
  check((await state()).rows.includes('서울 · 테스트'),'source location name was translated');
  await focus('City name');await capture('preferences-english-data');
  await call('Reopen');
  await waitFor(async()=>(await state()).language==='en'&&(await state()).rows.includes('Private iCal address')&&(await state()).subscriptions===1,'reopened preferences lost language or leaked subscriptions');
  await selectLanguage('ko');
  await waitFor(async()=>(await state()).rows.includes('비공개 iCal 주소'),'reopened preferences did not switch back');

  print('PREFERENCES_TEST: actual GTK keyboard search/select/clear, secret submit/clear, error, Tab/Shift+Tab and placement/NIC controls passed');
 }finally{keyboard.run_dispose();child.force_exit();}
}
