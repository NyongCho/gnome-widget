import Gio from 'gi://Gio';import GLib from 'gi://GLib';import Shell from 'gi://Shell';import System from 'system';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import {capture,enable} from './helpers.js';
export const METRICS={};
const uuid=(GLib.getenv('LIQUID_TEST_UUID')||'liquid-widgets@local'),report={trials:[],soak:[],method:'GNOME 50 stagePaintStart → stagePaintDone (includes swap, no forced glFinish); foreground window follows the same 16ms motion in each trial',clockTicks:Number(GLib.getenv('LIQUID_CLOCK_TICKS')||100)};
const frames=[];let phase=-1,start=null;
function check(ok,message){if(!ok)throw new Error(message);}
async function until(predicate,message){for(let i=0;i<200;i++){if(predicate())return;await Scripting.sleep(30);}throw new Error(message);}
function read(path){const [ok,bytes]=GLib.file_get_contents(path);if(!ok)throw new Error('could not read measurement');return new TextDecoder().decode(bytes);}
function resources(pid='self'){
 const stat=read(`/proc/${pid}/stat`);const fields=stat.slice(stat.lastIndexOf(')')+2).trim().split(/\s+/);const status=read(`/proc/${pid}/status`);
 return{ticks:Number(fields[11])+Number(fields[12]),rssKiB:Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1]??0)};
}
function gpu(){try{const [ok,bytes]=GLib.spawn_command_line_sync('nvidia-smi --query-gpu=name,driver_version,memory.used,utilization.gpu --format=csv,noheader,nounits');return ok?new TextDecoder().decode(bytes).trim():null;}catch{return null;}}
function save(){GLib.file_set_contents(`${GLib.getenv('LIQUID_TEST_OUTPUT')}/performance.json`,JSON.stringify(report,null,2));}
export function script_trialStart(_time,id){phase=id;start=null;}
export function script_trialEnd(){phase=-1;start=null;}
export function clutter_stagePaintStart(time){if(phase>=0)start=time;}
export function clutter_stagePaintDone(time){if(phase>=0&&start!==null){(frames[phase]??=[]).push((time-start)/1000);start=null;}}
function summarize(){
 frames.length=0;phase=-1;start=null;
 Shell.PerfLog.get_default().replay((time,name,_signature,arg)=>{
  if(name==='script.trialStart')script_trialStart(time,arg);else if(name==='script.trialEnd')script_trialEnd();else if(name==='clutter.stagePaintStart')clutter_stagePaintStart(time);else if(name==='clutter.stagePaintDone')clutter_stagePaintDone(time);
 });
 for(let i=0;i<report.trials.length;i++){const samples=[...(frames[i]??[])].sort((a,b)=>a-b);check(samples.length>60,'not enough actual compositor frames');report.trials[i].frames=samples.length;report.trials[i].paintP95Ms=samples[Math.ceil(samples.length*.95)-1];}
 report.pairs=[0,1,2].map(i=>({trial:i+1,p95IncreaseMs:report.trials[i*2+1].paintP95Ms-report.trials[i*2].paintP95Ms}));save();
}
export async function run(){
 Main.overview.hide();await Scripting.sleep(1500);await enable('ding@rastersoft.com');await enable('blur-my-shell@aunetx');
 // The distro's Ubuntu Dock is loaded only inside this disposable GNOME session.
 await enable('ubuntu-dock@ubuntu.com');
 let ext=Main.extensionManager.lookup(uuid);check(ext?.stateObj?.host,'extension missing');
 const settings=ext.stateObj.settings;settings.set_strv('visible',['clock','calendar','weather','agenda','network','system','media']);
 // GNOME's perf helper exits after 30s without a D-Bus call. Keep its test window alive.
 const keepAlive=GLib.timeout_add(GLib.PRIORITY_DEFAULT,10000,()=>{void Scripting.waitTestWindows();return GLib.SOURCE_CONTINUE;});
 const daemon=Gio.Subprocess.new([GLib.getenv('LIQUID_TEST_DAEMON')],Gio.SubprocessFlags.NONE);const daemonPid=daemon.get_identifier();
 try{
  await until(()=>ext.stateObj.host.connected,'service did not connect');
  report.gpu=gpu();report.stage={width:global.stage.width,height:global.stage.height};
  const before=new Set(global.get_window_actors());await Scripting.createTestWindow({width:420,height:320,redraws:true});await Scripting.waitTestWindows();let app;
  await until(()=>{app=global.get_window_actors().find(a=>!before.has(a)&&a.mapped&&a.meta_window.get_frame_rect().width>=420);return !!app;},'foreground test window did not map');
  let windowAlive=true;app.meta_window.connect('unmanaged',()=>{windowAlive=false;});
  const perf=Shell.PerfLog.get_default();perf.define_event('script.trialStart','Trial begins','i');perf.define_event('script.trialEnd','Trial ends','');global.set_frame_timestamps(true);global.set_frame_finish_timestamp(false);
  for(let trial=0;trial<6;trial++){
   const on=trial%2===1;
   if(on){Main.extensionManager.enableExtension(uuid);await until(()=>ext.state===1&&ext.stateObj.host.connected,'enable did not reconnect');}
   else{Main.extensionManager.disableExtension(uuid);await until(()=>ext.state===2,'disable did not settle');}
   await Scripting.sleep(2500);
   let step=0;const moving=GLib.timeout_add(GLib.PRIORITY_DEFAULT,16,()=>{if(!windowAlive)return GLib.SOURCE_REMOVE;app.meta_window.move_frame(false,Math.round(610+140*Math.sin(step/45)),Math.round(180+80*Math.cos(step/60)));step++;return GLib.SOURCE_CONTINUE;});
   await Scripting.sleep(1000);
   const shellStart=resources(),serviceStart=resources(daemonPid),time=GLib.get_monotonic_time();perf.event_i('script.trialStart',trial);
   await Scripting.sleep(20000);
   perf.event('script.trialEnd');const seconds=(GLib.get_monotonic_time()-time)/1e6;const shellEnd=resources(),serviceEnd=resources(daemonPid);if(windowAlive)GLib.Source.remove(moving);check(windowAlive,'foreground window disappeared; trial invalid');
   report.trials.push({mode:on?'ON':'OFF',seconds,shellCpuPercent:(shellEnd.ticks-shellStart.ticks)/report.clockTicks/seconds*100,serviceCpuPercent:(serviceEnd.ticks-serviceStart.ticks)/report.clockTicks/seconds*100,shellRssKiB:shellEnd.rssKiB,serviceRssKiB:serviceEnd.rssKiB,offscreenBytes:on?[...ext.stateObj.host.cards.values()].reduce((sum,c)=>sum+c.surface.diagnostics.textureBytes,0):0,gpu:gpu()});
   print(`PERF_TRIAL: ${JSON.stringify(report.trials.at(-1))}`);
  }
  global.set_frame_timestamps(false);await Scripting.destroyTestWindows();summarize();await capture('widgets-benchmark');
  const soakSeconds=Number(GLib.getenv('LIQUID_SOAK_SECONDS')||0);
  if(soakSeconds){
   // Use a temporary public weather selection. This private bus/XDG session never changes the user's city.
   const call=(method,params)=>new Promise((resolve,reject)=>Gio.DBus.session.call('org.local.LiquidWidgets','/org/local/LiquidWidgets','org.local.LiquidWidgets1',method,params,null,Gio.DBusCallFlags.NONE,10000,null,(bus,result)=>{try{resolve(bus.call_finish(result));}catch(e){reject(e);}}));
   await call('SetWeatherLocation',new GLib.Variant('(s)',[JSON.stringify({id:'1835848',label:'서울 · 시험 지역',latitude:37.5665,longitude:126.978,timeZone:'Asia/Seoul'})]));
   await Scripting.sleep(3000);System.gc();const started=GLib.get_monotonic_time();
   const snapshot=()=>({seconds:(GLib.get_monotonic_time()-started)/1e6,shell:resources(),service:resources(daemonPid),roots:global.window_group.get_children().filter(a=>a.name==='liquid-widgets-layer').length,cards:ext.stateObj.host.diagnostics.cards,offscreenBytes:[...ext.stateObj.host.cards.values()].reduce((sum,c)=>sum+c.surface.diagnostics.textureBytes,0)});
   report.soak.push(snapshot());save();
   while((GLib.get_monotonic_time()-started)/1e6<soakSeconds){await Scripting.sleep(Math.min(60000,Math.max(1,soakSeconds*1000-(GLib.get_monotonic_time()-started)/1000)));report.soak.push(snapshot());save();print(`SOAK: ${JSON.stringify(report.soak.at(-1))}`);check(report.soak.at(-1).roots===1,'duplicate layer during soak');}
   System.gc();await Scripting.sleep(300);report.soakAfterGc=snapshot();
   for(let i=0;i<20;i++){Main.extensionManager.disableExtension(uuid);await until(()=>ext.state===2,'soak disable failed');check(global.window_group.get_children().filter(a=>a.name==='liquid-widgets-layer').length===0,'orphan layer');Main.extensionManager.enableExtension(uuid);await until(()=>ext.state===1&&ext.stateObj.host.connected,'soak enable failed');await Scripting.sleep(100);}
   System.gc();await Scripting.sleep(500);report.afterCycles=snapshot();save();await capture('widgets-soak-final');
  }
  print('PERFORMANCE_TEST: actual GPU OFF/ON measurements and requested soak complete');
 }finally{GLib.Source.remove(keepAlive);daemon.force_exit();global.set_frame_timestamps(false);}
}
export function finish(){summarize();}
