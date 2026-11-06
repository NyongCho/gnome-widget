import Gio from 'gi://Gio';import GLib from 'gi://GLib';import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import {capture,setScale,findNamed} from './helpers.js';
export const METRICS={};
function check(ok,message){if(!ok)throw new Error(message);}
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const defaults={left:['clock','calendar','agenda'],right:['weather','system','network','media']};
const all=[...defaults.left,...defaults.right];
const call=(method,args=null)=>new Promise((resolve,reject)=>Gio.DBus.session.call('org.local.LiquidCardOrderTest','/org/local/LiquidCardOrderTest','org.local.LiquidCardOrderTest1',method,args,null,Gio.DBusCallFlags.NONE,5000,null,(bus,result)=>{try{resolve(bus.call_finish(result).deep_unpack());}catch(e){reject(e);}}));
const state=async()=>JSON.parse((await call('State'))[0]);
async function waitFor(predicate,message){for(let i=0;i<80;i++){try{if(await predicate())return;}catch{}await Scripting.sleep(50);}throw new Error(message);}
export async function run(){
 Main.overview.hide();await Scripting.sleep(1000);
 const ext=Main.extensionManager.lookup((GLib.getenv('LIQUID_TEST_UUID')||'liquid-widgets@local')).stateObj,settings=ext.settings,host=ext.host;
 ext.client.destroy();ext.client=null;ext.clock.destroy();ext.clock=null;
 const write=columns=>settings.set_value('card-columns',new GLib.Variant('aas',[columns.left,columns.right]));
 settings.set_strv('visible',all);settings.set_strv('card-order',['system','clock','calendar']);settings.reset('card-columns');Gio.Settings.sync();
 const child=Gio.Subprocess.new(['gjs','-m',GLib.getenv('LIQUID_TEST_CARD_ORDER')],Gio.SubprocessFlags.NONE);
 const keyboard=global.stage.get_context().get_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
 const seed=(left,right,visible=all)=>call('Seed',new GLib.Variant('(asasas)',[left,right,visible]));
 const activate=async(id,control)=>{
  await call('Focus',new GLib.Variant('(ss)',[id,control]));await Scripting.sleep(100);
  const key=control==='toggle'?Clutter.KEY_space:Clutter.KEY_Return;
  keyboard.notify_keyval(GLib.get_monotonic_time(),key,Clutter.KeyState.PRESSED);await Scripting.sleep(30);
  keyboard.notify_keyval(GLib.get_monotonic_time(),key,Clutter.KeyState.RELEASED);await Scripting.sleep(150);
 };
 const expectRows=async(columns,message)=>waitFor(async()=>{
  const s=await state();return same(s.columns,columns)&&same(s.rows.left.map(r=>r.id),columns.left)&&same(s.rows.right.map(r=>r.id),columns.right);
 },message);
 try{
  await waitFor(async()=>Boolean((await state()).columns),'card preferences did not open');
  await waitFor(async()=>global.display.focus_window?.get_title()==='Liquid Card Order Keyboard Test','preferences not focused');
  check((await state()).rows.left.length===3&&(await state()).rows.right.length===4,'preferences need separate left/right card lists');
  await expectRows(defaults,'requested default columns were not used');
  for(const side of ['left','right'])check(!(await state()).rows[side][0].upSensitive&&!(await state()).rows[side].at(-1).downSensitive,'within-column boundaries are wrong');
  await activate('calendar','up');await expectRows({...defaults,left:['calendar','clock','agenda']},'within-column move failed');
  check((await state()).focus.includes('card-columns-calendar-down'),'boundary move lost focus');
  await activate('calendar','down');await expectRows(defaults,'within-column move down failed');
  await activate('calendar','transfer');
  const moved={left:['clock','agenda'],right:['weather','system','network','media','calendar']};
  await expectRows(moved,'transfer to right failed');
  check((await state()).focus.includes('card-columns-calendar-transfer'),'transfer lost keyboard focus');
  check((await state()).rows.right.at(-1).transferTooltip.includes('왼쪽 열로 이동'),'transfer target did not reverse');
  await activate('calendar','up');
  const reordered={left:['clock','agenda'],right:['weather','system','network','calendar','media']};
  await expectRows(reordered,'reorder in destination failed');
  await activate('calendar','toggle');await waitFor(async()=>!(await state()).visible.includes('calendar'),'disable failed');
  await activate('calendar','toggle');await expectRows(reordered,'reenable changed membership/order');
  await activate('calendar','transfer');await activate('calendar','up');await expectRows(defaults,'return to left failed');
  await call('Focus',new GLib.Variant('(ss)',['clock','transfer']));await Scripting.sleep(300);await capture('columns-settings-left');
  await call('Focus',new GLib.Variant('(ss)',['media','transfer']));await Scripting.sleep(300);await capture('columns-settings-right');
  settings.set_string('language','en');Gio.Settings.sync();
  await waitFor(async()=>(await state()).groups.left.title==='Left column'&&(await state()).groups.right.title==='Right column','column headings did not translate');
  check((await state()).rows.left[0].transferTooltip.includes('Move to right column'),'transfer action did not translate');
  await call('Reopen');await expectRows(defaults,'reopening lost columns');
  await seed([],all);await expectRows({left:[],right:all},'empty left column was not retained');
  await activate('clock','transfer');await expectRows({left:['clock'],right:all.filter(id=>id!=='clock')},'transfer to empty column failed');
  const only=(await state()).rows.left[0];check(!only.upSensitive&&!only.downSensitive,'single-card column has enabled ordering buttons');
  check((await state()).focus.includes('card-columns-clock-transfer'),'transfer to empty column lost focus');
  await seed(['weather','clock','clock','bad'],['weather','system']);
  await expectRows({left:['weather','clock','calendar','agenda'],right:['system','network','media']},'malformed external columns not normalized');
  await seed(defaults.left,defaults.right);await expectRows(defaults,'external columns not restored');
  print('COLUMN_PREFERENCES: transfer both ways, in-column order, visibility, focus, language, empty side, normalization and reopening passed');
 }finally{keyboard.run_dispose();child.force_exit();}
 await Scripting.sleep(300);settings.set_string('language','ko');host.setConnected(true);
 settings.set_value('card-columns',new GLib.Variant('aas',[[],[]]));await Scripting.sleep(100);
 check(same(settings.get_value('card-columns').deep_unpack(),[defaults.left,defaults.right]),'closed-preferences reset did not normalize');
 check(same(settings.get_strv('card-order'),['system','clock','calendar']),'legacy rollback setting changed');
 const now=Date.parse('2026-11-04T04:30:00Z');host.tick(now,'Asia/Seoul',false,'ko-KR',1);
 const wrap=data=>({status:'ok',sourceId:'columns-fixture',updatedAt:new Date(now).toISOString(),errorCode:null,data});
 const weather=wrap({location:'서울특별시 · 대한민국',timeZone:'Asia/Seoul',current:{temperatureC:16,code:2},hourly:Array.from({length:6},(_,i)=>({at:new Date(now+(i+1)*3600000).toISOString(),temperatureC:16-i,precipitationProbability:10*i})),attributionUrl:'https://open-meteo.com/'});
 const noMedia={status:'unavailable',sourceId:'fixture',updatedAt:null,data:null,errorCode:'NO_PLAYER'};
 host.updateProvider('calendar',wrap({month:'2026-11',timeZone:'Asia/Seoul',weekStart:1,events:[]}));host.updateProvider('weather',weather);
 host.updateProvider('system',wrap({cpuPercent:25,memoryUsedBytes:16*2**30,memoryTotalBytes:32*2**30,temperatureC:43}));
 host.updateProvider('network',wrap({interface:'test0',rxBytesPerSec:1024,txBytesPerSec:512,history:[]}));host.updateProvider('media',noMedia);ext.layout();
 const report=[];
 function verify(expected,columns=2){
  const cards=host.current.cards,scale=settings.get_double('scale');
  check(same(cards.map(c=>c.id),[...expected.left,...expected.right]),'Shell list order differs from columns');check(host.current.columns===columns,'wrong responsive column count');
  const stacks=columns===2?[expected.left,expected.right]:[[...expected.left,...expected.right]];
  for(let side=0;side<stacks.length;side++){
   let y=0;for(const id of stacks[side]){const c=cards.find(c=>c.id===id),button=host.cards.get(id).button;
    check(Math.abs(c.rect.y-y)<1,'stack is coupled to the other column');check(c.rect.x===(side?(cards[0].rect.width+14*scale):0),'card is in wrong column');
    check(Math.abs(button.width-c.rect.width)<1&&Math.abs(button.height-c.rect.height)<1,'actual card allocation differs from layout');y+=c.rect.height+14*scale;
   }
  }
  const clock=host.cards.get('clock'),weatherCard=host.cards.get('weather');
  if(clock&&weatherCard)check(clock.button.height===weatherCard.button.height&&clock.button.width===weatherCard.button.width,'clock does not match weather dimensions');
  if(clock){const time=findNamed(clock.body,'liquid-clock-digits');
   check(Boolean(time),'digital clock is missing');check(time.get_preferred_width(-1)[1]<=clock.button.width-34*scale,'clock text overflows');}
  check(same(host.canvas.get_children().map(actor=>[...host.cards].find(([,card])=>card.surface.actor===actor)[0]),[...expected.left,...expected.right]),'keyboard actor order differs from columns');
 }
 const visibleDefault={left:defaults.left,right:['weather','system','network']};
 await Scripting.sleep(200);verify(visibleDefault);await capture('columns-grid');report.push({name:'default',layout:host.current});
 const desktop=new Gio.Settings({schema_id:'org.gnome.desktop.interface'});desktop.set_string('color-scheme','prefer-dark');await Scripting.sleep(200);verify(visibleDefault);await capture('columns-grid-dark');
 host.updateProvider('weather',{...weather,status:'stale',errorCode:'NETWORK_ERROR'});await Scripting.sleep(150);verify(visibleDefault);host.updateProvider('weather',weather);
 const rightBefore=host.current.cards.filter(c=>visibleDefault.right.includes(c.id));settings.set_strv('visible',all.filter(id=>id!=='calendar'));await Scripting.sleep(150);
 verify({left:['clock','agenda'],right:visibleDefault.right});check(same(rightBefore,host.current.cards.filter(c=>visibleDefault.right.includes(c.id))),'hiding a left card moved right cards');
 settings.set_strv('visible',all);write({left:['clock','calendar','agenda','weather'],right:['system','network','media']});await Scripting.sleep(150);verify({left:['clock','calendar','agenda','weather'],right:['system','network']});await capture('columns-transferred');
 write(defaults);await Scripting.sleep(100);host.updateProvider('media',wrap({player:'org.mpris.MediaPlayer2.fixture',status:'playing',title:'Test song',artist:'Test artist',artUri:null}));ext.layout();await Scripting.sleep(100);verify(defaults);host.updateProvider('media',noMedia);ext.layout();await Scripting.sleep(100);verify(visibleDefault);
 settings.set_double('scale',1.5);settings.set_string('language','en');await Scripting.sleep(200);verify(visibleDefault);
 settings.set_double('scale',1);settings.set_string('language','ko');await Scripting.sleep(100);
 host.layout({monitor:'primary',anchor:'top-right',offsetX:24,offsetY:20,scale:1,visible:all},{x:900,y:40,width:300,height:420},0);await Scripting.sleep(100);verify(visibleDefault,1);
 ext.layout();await setScale(1.25);verify(visibleDefault);await capture('columns-grid-125');report.push({name:'125%',layout:host.current});
 GLib.file_set_contents(`${GLib.getenv('LIQUID_TEST_OUTPUT')}/columns.json`,JSON.stringify(report,null,2));
 print('COLUMN_SHELL: independent stacks, matching clock/weather, digital clock, hide/transfer, media, language/scale, one column and 125% passed');
}
