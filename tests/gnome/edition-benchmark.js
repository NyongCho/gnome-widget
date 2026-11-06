import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import {capture,settledMaterial} from './helpers.js';
import {selectFixture} from './benchmark-io.js';
export const METRICS={};
const edition=GLib.getenv('LIQUID_TEST_EDITION'),uuid=GLib.getenv('LIQUID_TEST_UUID'),output=GLib.getenv('LIQUID_TEST_OUTPUT');
const fixtures=GLib.getenv('LIQUID_BENCH_FIXTURES'),warmup=Number(GLib.getenv('LIQUID_BENCH_WARMUP')||30),duration=Number(GLib.getenv('LIQUID_BENCH_DURATION')||120);
const now=()=>GLib.get_monotonic_time();
const read=path=>new TextDecoder().decode(GLib.file_get_contents(path)[1]);
const write=(name,value)=>GLib.file_set_contents(`${output}/${name}`,JSON.stringify(value));
const report={edition,run:Number(GLib.getenv('LIQUID_BENCH_RUN')||0),phases:[],updates:[],warmupSeconds:warmup,durationSeconds:duration};
let current=-1;const timestamps=[];
export function script_editionPhaseStart(_time,id){current=id;}
export function script_editionPhaseEnd(){current=-1;}
export function clutter_stagePaintStart(time){if(current>=0)(timestamps[current]??=[]).push(time);}
function check(value,message){if(!value)throw new Error(message);}
async function until(test,message,ms=12000){const end=now()+ms*1000;while(!await test()){if(now()>=end)throw new Error(typeof message==='function'?message():message);await Scripting.sleep(10);}}
const call=(bus,path,iface,method,args=null)=>new Promise((resolve,reject)=>Gio.DBus.session.call(bus,path,iface,method,args,null,Gio.DBusCallFlags.NO_AUTO_START,10000,null,(conn,res)=>{try{resolve(conn.call_finish(res).deep_unpack());}catch(e){reject(e);}}));
const owned=async name=>(await call('org.freedesktop.DBus','/org/freedesktop/DBus','org.freedesktop.DBus','NameHasOwner',new GLib.Variant('(s)',[name])))[0];
function resources(pid='self'){
 const stat=read(`/proc/${pid}/stat`),fields=stat.slice(stat.lastIndexOf(')')+2).trim().split(/\s+/);
 return{ticks:Number(fields[11])+Number(fields[12]),reapedTicks:Number(fields[13])+Number(fields[14])};
}
function media(){
 const iface='org.freedesktop.DBus.Properties',player='org.mpris.MediaPlayer2.Player';
 const obj=Gio.DBusExportedObject.wrapJSObject(`<node><interface name="${iface}"><method name="GetAll"><arg type="s" direction="in"/><arg type="a{sv}" direction="out"/></method></interface></node>`,{
  GetAll(request){return request===player?{PlaybackStatus:new GLib.Variant('s','Playing'),Metadata:new GLib.Variant('a{sv}',{'xesam:title':new GLib.Variant('s','Synthetic benchmark'),'xesam:artist':new GLib.Variant('as',['Fixture']),'mpris:trackid':new GLib.Variant('o','/benchmark/track')})}:{Identity:new GLib.Variant('s','Benchmark')};}
 });
 obj.export(Gio.DBus.session,'/org/mpris/MediaPlayer2');const name=Gio.bus_own_name_on_connection(Gio.DBus.session,'org.mpris.MediaPlayer2.liquidBenchmark',Gio.BusNameOwnerFlags.NONE,null,null);
 return()=>{Gio.bus_unown_name(name);obj.unexport();};
}
function save(){
 timestamps.length=0;current=-1;const allFrames=[];
 Shell.PerfLog.get_default().replay((time,name,_signature,arg)=>{if(name==='script.editionPhaseStart')script_editionPhaseStart(time,arg);else if(name==='script.editionPhaseEnd')script_editionPhaseEnd();else if(name==='clutter.stagePaintStart'){allFrames.push(time);clutter_stagePaintStart(time);}});
 for(let i=0;i<report.phases.length;i++)report.phases[i].frameTimestampsUs=timestamps[i]??[];
 for(const row of report.updates){row.firstPaintUs=allFrames.find(time=>time>=row.publishedUs)??null;if(row.firstPaintUs)row.elapsedMs=(row.firstPaintUs-row.startedUs)/1000;}
 if(report.coldPublishedUs){const frame=allFrames.find(time=>time>=report.coldPublishedUs);if(frame)report.coldUpdateMs=(frame-report.coldStartedUs)/1000;}
 write('benchmark.json',report);
}
export async function run(){
 Main.overview.hide();await Scripting.sleep(1000);
 const ext=Main.extensionManager.lookup(uuid).stateObj,host=ext.host,settings=ext.settings;
 settings.set_strv('visible',['clock']);settings.set_string('clock-style','digital');settings.set_string('language','en');settings.set_double('scale',.75);
 settings.set_double('strength',16);settings.set_double('opacity',.24);settings.set_boolean('low-power',false);
 new Gio.Settings({schema_id:'org.gnome.desktop.interface'}).set_string('color-scheme','prefer-dark');
 ext.clock.destroy();ext.clock=null;host.tick(Date.parse('2026-11-07T00:00:00Z'),'UTC',false,'en-US',1);
 ext.client.setCalendarContext({month:'2026-11',timeZone:'UTC',weekStart:1},'2026-11-07');
 const stopMedia=media();let daemon=null,motion=0;
 // GNOME's automation helper exits after 30s without any D-Bus request.
 const keepAlive=GLib.timeout_add(0,10000,()=>{void Scripting.waitTestWindows();return GLib.SOURCE_CONTINUE;});
 const animation=new St.Widget({style:'background-color:rgba(245,210,160,0.85);border-radius:20px;',width:300,height:180,reactive:false});global.window_group.add_child(animation);
 let completed=0,publishedUs=0,measuring='';report.transientSampleLoads=0;const update=host.updateProvider.bind(host);
 host.updateProvider=function(name,state){if(measuring==='all'&&['system','network'].includes(name)&&state.status==='loading'&&state.data!==null)report.transientSampleLoads++;update(name,state);if(name==='calendar'&&state.status==='ok'){completed++;publishedUs=now();}};
 const perf=Shell.PerfLog.get_default();perf.define_event('script.editionPhaseStart','Edition phase starts','i');perf.define_event('script.editionPhaseEnd','Edition phase ends','');
 global.set_frame_timestamps(true);global.set_frame_finish_timestamp(false);
 try{
  if(edition==='gjs'){
   const fixture=await import(Gio.File.new_for_path(`${GLib.getenv('LIQUID_TEST_WORKER')}/tests/benchmark.js`).get_uri());await fixture.configure(ext.client,fixtures);
  }else daemon=Gio.Subprocess.new([GLib.getenv('LIQUID_BENCH_RUST')],Gio.SubprocessFlags.NONE);
  const shellPid=Number(read('/proc/self/stat').split(' ')[0]),rustPid=daemon?Number(daemon.get_identifier()):null;
  report.shellPid=shellPid;report.rustPid=rustPid;report.stage={width:global.stage.width,height:global.stage.height};
  write('pids.json',{shellPid,rustPid});
  const cold=now();settings.set_strv('visible',['clock','calendar','agenda','weather','system','network','media']);
  await until(()=>completed>0&&host.visibleCards.length===7&&host.states.get('weather')?.status==='ok',()=>`initial providers failed: ${edition}; completed=${completed}; cards=${host.visibleCards.length}; states=${JSON.stringify([...host.states].map(([name,state])=>({name,status:state.status,errorCode:state.errorCode})))}`);
  await Scripting.sleep(40);report.coldStartedUs=cold;report.coldPublishedUs=publishedUs;report.coldUpdateMs=(now()-cold)/1000;
  check(host.states.get('calendar').data.events.length===1000,'cold calendar fixture incomplete');
  await settledMaterial(host.cards.get('clock').surface);
  let step=0;motion=GLib.timeout_add(0,16,()=>{animation.set_position(Math.round(150+130*Math.sin(step/45)),Math.round(150+90*Math.cos(step/60)));step++;return GLib.SOURCE_CONTINUE;});
  print(`EDITION_BENCH: ${edition} warmup ${warmup}s, cold update ${report.coldUpdateMs.toFixed(1)}ms`);
  await Scripting.sleep(warmup*1000);
  const snapshot=()=>({shell:resources(),rust:rustPid?resources(rustPid):null});
  async function phase(name,action){
   const index=report.phases.length,start=now(),before=snapshot();measuring=name;write('phase.json',{name,startUs:start});perf.event_i('script.editionPhaseStart',index);
   if(action)await action(start);
   await Scripting.sleep(Math.max(1,duration*1000-(now()-start)/1000));
   perf.event('script.editionPhaseEnd');measuring='';const end=now(),after=snapshot(),seconds=(end-start)/1e6,hz=Number(GLib.getenv('LIQUID_CLOCK_TICKS'));
   const delta=(a,b)=>b.ticks+b.reapedTicks-a.ticks-a.reapedTicks;
   report.phases.push({name,startUs:start,endUs:end,seconds,cpuPercent:(delta(before.shell,after.shell)+(before.rust?delta(before.rust,after.rust):0))/hz/seconds*100,shellCpuPercent:(after.shell.ticks-before.shell.ticks)/hz/seconds*100});
   save();print(`EDITION_BENCH: ${edition}/${name} ${seconds.toFixed(1)}s CPU ${report.phases.at(-1).cpuPercent.toFixed(2)}%`);
  }
  settings.set_strv('visible',['clock']);await Scripting.sleep(500);
  check(!await owned('io.github.NyongCho.LiquidWidgets.CalendarJob'),'idle calendar worker remains');
  await phase('idle');
  check(!await owned('io.github.NyongCho.LiquidWidgets.CalendarJob'),'idle calendar worker appeared');
  settings.set_strv('visible',['clock','calendar','agenda','weather','system','network','media']);
  await until(()=>host.visibleCards.length===7&&host.states.get('calendar')?.status==='ok','all cards did not return');await Scripting.sleep(1000);
  await phase('all',async start=>{
   const offsets=duration>=120?[10,35,60,85]:[1,8,15,22];
   for(const [index,name] of ['1k','10k','5mib','sparse'].entries()){
    await Scripting.sleep(Math.max(1,offsets[index]*1000-(now()-start)/1000));
    await selectFixture(fixtures,name);const before=completed,started=now();
    if(edition==='gjs')ext.client.refresh('calendar');else await call('org.local.LiquidWidgets','/org/local/LiquidWidgets','org.local.LiquidWidgets1','Refresh',new GLib.Variant('(s)',['calendar']));
    await until(()=>completed>before,`${name} failed: ${JSON.stringify(host.states.get('calendar'))}`,11000);
    // Ensure the published DTO has also reached a compositor frame.
    await Scripting.sleep(40);const elapsed=(now()-started)/1000,count=host.states.get('calendar').data.events.length;
    check(count===(name==='1k'||name==='10k'?1000:name==='5mib'?1:0),`${name} result count ${count}`);
    check(elapsed<9000,`${name} approaches the worker execution budget`);
    report.updates.push({name,startedUs:started,publishedUs,finishedUs:now(),elapsedMs:elapsed,events:count});
    print(`EDITION_BENCH_UPDATE: ${JSON.stringify(report.updates.at(-1))}`);
   }
  });
  check(report.transientSampleLoads===0,'periodic sampling flashes the loading footer');
  settings.set_strv('visible',['clock']);await Scripting.sleep(500);check(!await owned('io.github.NyongCho.LiquidWidgets.CalendarJob'),'completed workload left a child');
  await capture('edition-benchmark');save();write('phase.json',{name:'done',startUs:now()});print('EDITION_BENCH: measured all phases successfully');
 }finally{GLib.Source.remove(keepAlive);if(motion)GLib.Source.remove(motion);animation.destroy();stopMedia();daemon?.force_exit();global.set_frame_timestamps(false);}
}
export function finish(){save();}
