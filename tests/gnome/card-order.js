import Gio from 'gi://Gio';import GLib from 'gi://GLib';import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import {capture,setScale} from './helpers.js';
export const METRICS={};
function check(ok,message){if(!ok)throw new Error(message);}
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const call=(method,args=null)=>new Promise((resolve,reject)=>Gio.DBus.session.call('org.local.LiquidCardOrderTest','/org/local/LiquidCardOrderTest','org.local.LiquidCardOrderTest1',method,args,null,Gio.DBusCallFlags.NONE,5000,null,(bus,result)=>{try{resolve(bus.call_finish(result).deep_unpack());}catch(e){reject(e);}}));
const state=async()=>JSON.parse((await call('State'))[0]);
async function waitFor(predicate,message){for(let i=0;i<80;i++){try{if(await predicate())return;}catch{}await Scripting.sleep(50);}throw new Error(message);}
export async function run(){
 Main.overview.hide();await Scripting.sleep(1000);
 const ext=Main.extensionManager.lookup('liquid-widgets@local').stateObj,settings=ext.settings,host=ext.host;
 ext.client.stop();ext.client=null;ext.clock.destroy();ext.clock=null;
 settings.set_strv('visible',['system','clock','calendar']);settings.set_strv('card-order',[]);Gio.Settings.sync();
 const child=Gio.Subprocess.new(['gjs','-m',GLib.getenv('LIQUID_TEST_CARD_ORDER')],Gio.SubprocessFlags.NONE);
 const repairs=[];
 const keyboard=global.stage.get_context().get_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
 const seed=(order,visible)=>call('Seed',new GLib.Variant('(asas)',[order,visible]));
 const activate=async(id,control)=>{
  await call('Focus',new GLib.Variant('(ss)',[id,control]));await Scripting.sleep(100);
  const key=control==='toggle'?Clutter.KEY_space:Clutter.KEY_Return;
  keyboard.notify_keyval(GLib.get_monotonic_time(),key,Clutter.KeyState.PRESSED);await Scripting.sleep(30);
  keyboard.notify_keyval(GLib.get_monotonic_time(),key,Clutter.KeyState.RELEASED);await Scripting.sleep(100);
 };
 try{
  await waitFor(async()=>(await state()).rows.length===7,'card preferences did not open');
  await waitFor(async()=>global.display.focus_window?.get_title()==='Liquid Card Order Keyboard Test','preferences not focused');
  check((await state()).rows.every(row=>row.upSensitive!==null&&row.downSensitive!==null),'card list needs move controls');
  const initial=['system','clock','calendar','weather','agenda','network','media'];
  check(same((await state()).order,initial),'migration changed existing visible order');
  check(same((await state()).rows.map(row=>row.id),initial),'GTK list ignores saved order');
  check(!(await state()).rows[0].upSensitive&&!(await state()).rows.at(-1).downSensitive,'boundary controls must be disabled');
  await activate('calendar','up');
  const moved=['system','calendar','clock','weather','agenda','network','media'];
  await waitFor(async()=>same((await state()).rows.map(row=>row.id),moved),'keyboard move did not reorder list');
  check((await state()).focus.includes('card-order-calendar-up'),'moving a row lost keyboard focus');
  await activate('calendar','up');
  check((await state()).rows[0].id==='calendar'&&!(await state()).rows[0].upSensitive,'moving to the first row did not update its boundary');
  check((await state()).focus.includes('card-order-calendar-down'),'moving to a boundary lost usable keyboard focus');
  await activate('calendar','down');
  await activate('weather','up');
  const retained=['system','calendar','weather','clock','agenda','network','media'];
  await activate('weather','toggle');await waitFor(async()=>(await state()).visible.includes('weather'),'toggle did not enable card');
  await activate('weather','toggle');await waitFor(async()=>!(await state()).visible.includes('weather'),'toggle did not disable card');
  await activate('weather','toggle');
  check(same((await state()).order,retained),'re-enabling a card changed its position');
  await Scripting.sleep(300);await capture('order-settings-korean');
  settings.set_string('language','en');Gio.Settings.sync();
  await waitFor(async()=>(await state()).rows.find(row=>row.id==='clock').title==='Date and clock','list language did not update');
  check((await state()).rows.find(row=>row.id==='clock').upTooltip.includes('Move up'),'move control did not translate');
  await call('Reopen');
  await waitFor(async()=>same((await state()).rows.map(row=>row.id),retained),'reopening lost saved order');
  await capture('order-settings-english');
  const canonical=['clock','calendar','weather','agenda','network','system','media'];
  await seed(['clock','calendar','weather','agenda','network','system,media'],canonical);
  await Scripting.sleep(200);
  if(!same((await state()).order,canonical))repairs.push('malformed comma-containing ID remains persisted');
  await seed(['media','network','network','invalid','clock'],['clock','network']);
  const normalized=['media','network','clock','calendar','weather','agenda','system'];
  await waitFor(async()=>same((await state()).order,normalized)&&same((await state()).rows.map(row=>row.id),normalized),'external order was not normalized/reflected');
  const final=['system','network','clock','calendar','weather','agenda','media'];
  await seed(final,['media','agenda','weather','calendar','clock','network','system']);
  await waitFor(async()=>same((await state()).rows.map(row=>row.id),final),'external list change was not reflected');
  check((await state()).rows.every(row=>row.active),'external visibility was not reflected');
  print('ORDER_PREFERENCES: migration, keyboard move/toggle, boundaries, focus, language, external changes and reopening passed');
 }finally{keyboard.run_dispose();child.force_exit();}
 await Scripting.sleep(300);
 settings.set_strv('visible',['system','clock','calendar']);settings.set_strv('card-order',[]);
 await Scripting.sleep(200);
 if(!same(settings.get_strv('card-order'),['system','clock','calendar','weather','agenda','network','media'])||!same(host.visibleCards,['system','clock','calendar']))repairs.push('reset while preferences are closed disagrees with migration order');
 check(!repairs.length,repairs.join('; '));
 settings.set_strv('card-order',['system','network','clock','calendar','weather','agenda','media']);settings.set_strv('visible',['media','agenda','weather','calendar','clock','network','system']);
 settings.set_string('language','ko');host.setConnected(true);
 const now=Date.parse('2026-11-04T04:30:00Z');host.tick(now,'Asia/Seoul',false,'ko-KR',1);
 const fixture=JSON.parse(new TextDecoder().decode(GLib.file_get_contents(`${GLib.getenv('LIQUID_TEST_SCHEMAS')}/../../../tests/fixtures/protocol/snapshot-valid.json`)[1]));
 fixture.calendar.data={month:'2026-11',timeZone:'Asia/Seoul',weekStart:1,events:[]};
 fixture.media={status:'unavailable',sourceId:'fixture',updatedAt:null,data:null,errorCode:'NO_PLAYER'};
 host.update(fixture);ext.layout();
 const final=['system','network','clock','calendar','weather','agenda'];
 function verify(expected,columns=2){
  const cards=host.current.cards;check(same(cards.map(card=>card.id),expected),'Shell order differs from settings list');
  check(host.current.columns===columns,'wrong column count');
  for(let i=0;i<cards.length;i++){
   const rect=cards[i].rect,button=host.cards.get(cards[i].id).button;
   check(Math.abs(button.width-rect.width)<1,'actual card width differs from layout');
   check(rect.x===(i%columns?cards[1].rect.x:0),'card is in the wrong column');
   if(i%columns)check(rect.y===cards[i-1].rect.y,'paired cards are in different rows');
   if(i>=columns)check(rect.y>=cards[i-columns].rect.y+cards[i-columns].rect.height,'rows overlap');
  }
  const actors=host.canvas.get_children();check(same(actors.map(actor=>[...host.cards].find(([,card])=>card.surface.actor===actor)[0]),expected),'keyboard actor order differs from visual order');
  const clock=host.cards.get('clock');if(clock)check(clock.body.get_first_child().get_preferred_width(-1)[1]<=clock.button.width-34,'clock text does not fit one column');
 }
 await Scripting.sleep(200);verify(final);await capture('order-grid');
 settings.set_strv('card-order',['calendar','weather','network','system','agenda','clock','media']);
 await Scripting.sleep(200);const reordered=['calendar','weather','network','system','agenda','clock'];verify(reordered);await capture('order-grid-reordered');
 host.updateProvider('media',{status:'ok',sourceId:'fixture',updatedAt:new Date(now).toISOString(),errorCode:null,data:{player:'org.mpris.MediaPlayer2.fixture',status:'playing',title:'Test song',artist:'Test artist',artUri:null}});ext.layout();verify([...reordered,'media']);
 host.updateProvider('media',fixture.media);ext.layout();verify(reordered);
 host.layout({monitor:'primary',anchor:'top-right',offsetX:24,offsetY:20,scale:1,visible:settings.get_strv('visible')},{x:900,y:40,width:300,height:420},0);verify(reordered,1);
 ext.layout();await setScale(1.25);verify(reordered);await capture('order-grid-125');
 GLib.file_set_contents(`${GLib.getenv('LIQUID_TEST_OUTPUT')}/layout.json`,JSON.stringify(host.current,null,2));
 print('ORDER_SHELL: row-major order, single-slot clock, live reorder, hidden media, focus order, one column and 125% passed');
}
