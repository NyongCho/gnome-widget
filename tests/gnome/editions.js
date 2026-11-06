import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import {capture} from './helpers.js';
export const METRICS={};
const uuid=GLib.getenv('LIQUID_TEST_UUID')||'liquid-widgets@local',edition=GLib.getenv('LIQUID_TEST_EDITION')||'rust';
const BUS='io.github.NyongCho.LiquidWidgets.Status',PATH='/io/github/NyongCho/LiquidWidgets/Status',IFACE='io.github.NyongCho.LiquidWidgets.Status1';
function check(value,message){if(!value)throw new Error(message);}
async function until(predicate,message){for(let i=0;i<200;i++){if(await predicate())return;await Scripting.sleep(10);}throw new Error(message);}
const call=(bus,path,iface,method,args=null)=>new Promise((resolve,reject)=>Gio.DBus.session.call(bus,path,iface,method,args,null,Gio.DBusCallFlags.NO_AUTO_START,3000,null,(connection,result)=>{try{resolve(connection.call_finish(result).deep_unpack());}catch(error){reject(error);}}));
const owned=async name=>(await call('org.freedesktop.DBus','/org/freedesktop/DBus','org.freedesktop.DBus','NameHasOwner',new GLib.Variant('(s)',[name])))[0];
export async function run(){
    Main.overview.hide();await Scripting.sleep(1000);const extension=Main.extensionManager.lookup(uuid),ext=extension?.stateObj;
    check(ext?.host&&ext.client,'edition did not enable');
    check(typeof ext.client.destroy==='function','real extension still creates the old DataClient directly');
    check((typeof ext.client.setCalendarWatchers==='function')===(edition==='gjs'),'wrong backend factory path');
    await capture(`${edition}-factory`);
    if(edition==='rust'){check(ext.client.client,'Rust wrapper lost the existing client');print('EDITION_TEST: Rust factory and shared host loaded');return;}
    await until(()=>owned(BUS),'public bridge name missing');
    const session=ext.client;ext.settings.set_strv('visible',['clock']);await Scripting.sleep(100);
    // Request demand through the public protocol while every data card is hidden.
    const [token,raw]=await call(BUS,PATH,IFACE,'WatchCalendar');const summary=JSON.parse(raw);check(summary.instanceId&&session.watchers===1,'preferences demand did not reach the actual session');
    check(!await owned('org.local.LiquidWidgets'),'public edition launched the Rust daemon');
    Main.extensionManager.disableExtension(uuid);await until(()=>extension.state===2,'disable failed');await session.drained;
    check(session.dead&&session.unwatch===null,'disabled session retained config watch');check(!await owned(BUS),'disabled session retained status name');
    check([...session.schedulers.values()].every(s=>s.dead&&s.timer===null&&s.event===null),'disabled session retained provider sources');
    const calendar=session.deps.drivers.calendar;check(calendar.dead&&calendar.active.size===0,'disabled session retained calendar jobs');
    Main.extensionManager.enableExtension(uuid);await until(()=>extension.state===1&&extension.stateObj.client!==session,'new enable reused old session');await until(()=>owned(BUS),'new bridge not acquired');
    const [nextToken,nextRaw]=await call(BUS,PATH,IFACE,'WatchCalendar');check(JSON.parse(nextRaw).instanceId!==summary.instanceId,'enable reused old status instance');await call(BUS,PATH,IFACE,'UnwatchCalendar',new GLib.Variant('(s)',[token]));check(extension.stateObj.client.watchers===1,'late old token removed the new watch');await call(BUS,PATH,IFACE,'UnwatchCalendar',new GLib.Variant('(s)',[nextToken]));
    check(extension.stateObj.client.watchers===0,'watch token leaked');await capture('public-reenabled');
    // Keep the real production GTK preferences open across Shell disable/enable.
    Gio.Subprocess.new(['gnome-extensions','prefs',uuid],Gio.SubprocessFlags.NONE);
    let prefs;await until(()=>{prefs=global.get_window_actors().find(a=>a.mapped&&a.meta_window.get_title()==='Liquid Widgets');return prefs;},'production preferences did not open');
    await until(()=>extension.stateObj.client.watchers===1,'GTK did not acquire calendar demand');
    const previous=extension.stateObj.client;
    Main.extensionManager.disableExtension(uuid);await until(()=>extension.state===2,'disable with GTK open failed');await previous.drained;
    check(previous.dead&&previous.unwatch===null&&!await owned(BUS),'Shell resources survived with preferences open');
    check([...previous.schedulers.values()].every(s=>s.dead&&s.timer===null&&s.event===null),'Shell provider sources survived with GTK open');
    check(!await owned('io.github.NyongCho.LiquidWidgets.CalendarJob'),'unconfigured preview spawned a worker');
    check(prefs.mapped,'preferences closed with the extension');await capture('public-preferences-shell-off');
    Main.extensionManager.enableExtension(uuid);await until(()=>extension.state===1&&extension.stateObj.client.watchers===1,'GTK did not attach to the new Shell session');
    prefs.meta_window.delete(global.get_current_time());await until(()=>extension.stateObj.client.watchers===0,'closing real GTK leaked a watch');
    print('EDITION_TEST: public factory, hidden preferences demand, disable/reenable ownership and real GTK handoff passed');
}
