import Gio from 'gi://Gio';import GLib from 'gi://GLib';import System from 'system';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import {enable} from './helpers.js';
export const METRICS={};
async function until(fn){for(let i=0;i<200;i++){if(fn())return;await Scripting.sleep(30);}throw new Error('lifecycle transition did not settle');}
function rss(){const [ok,bytes]=GLib.file_get_contents('/proc/self/status');if(!ok)throw new Error('RSS unavailable');return Number(new TextDecoder().decode(bytes).match(/^VmRSS:\s+(\d+)/m)[1]);}
export async function run(){
 const keepAlive=GLib.timeout_add(GLib.PRIORITY_DEFAULT,10000,()=>{void Scripting.waitTestWindows();return GLib.SOURCE_CONTINUE;});
 Main.overview.hide();await Scripting.sleep(1500);await enable('ding@rastersoft.com');await enable('blur-my-shell@aunetx');await enable('ubuntu-dock@ubuntu.com');
 const uuid=(GLib.getenv('LIQUID_TEST_UUID')||'liquid-widgets@local'),ext=Main.extensionManager.lookup(uuid);ext.stateObj.settings.set_strv('visible',['clock','calendar','weather','agenda','network','system','media']);
 const daemon=Gio.Subprocess.new([GLib.getenv('LIQUID_TEST_DAEMON')],Gio.SubprocessFlags.NONE),samples=[];
 try{
  await until(()=>ext.stateObj.host.connected);await Scripting.sleep(2000);
  for(let block=0;block<=3;block++){
   if(block)for(let i=0;i<20;i++){
    Main.extensionManager.disableExtension(uuid);await until(()=>ext.state===2);
    if(global.window_group.get_children().some(a=>a.name==='liquid-widgets-layer'))throw new Error('orphan root');
    Main.extensionManager.enableExtension(uuid);await until(()=>ext.state===1&&ext.stateObj.host.connected);await Scripting.sleep(100);
   }
   System.gc();await Scripting.sleep(2000);System.gc();await Scripting.sleep(500);
   const sample={cycles:block*20,rssKiB:rss(),roots:global.window_group.get_children().filter(a=>a.name==='liquid-widgets-layer').length,cards:ext.stateObj.host.diagnostics.cards,offscreenBytes:[...ext.stateObj.host.cards.values()].reduce((n,c)=>n+c.surface.diagnostics.textureBytes,0)};samples.push(sample);print(`LIFECYCLE_MEMORY: ${JSON.stringify(sample)}`);
   GLib.file_set_contents(`${GLib.getenv('LIQUID_TEST_OUTPUT')}/lifecycle-memory.json`,JSON.stringify(samples,null,2));
  }
 }finally{GLib.Source.remove(keepAlive);daemon.force_exit();}
}
