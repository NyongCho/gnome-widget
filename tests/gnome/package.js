import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import {capture} from './helpers.js';
export const METRICS={};
const uuid='liquid-widgets@nyongcho.github.io';
function check(value,message){if(!value)throw new Error(message);}
async function until(test,message){const deadline=GLib.get_monotonic_time()+12000000;while(!await test()){check(GLib.get_monotonic_time()<deadline,message);await Scripting.sleep(20);}}
const owned=name=>new Promise((resolve,reject)=>Gio.DBus.session.call('org.freedesktop.DBus','/org/freedesktop/DBus','org.freedesktop.DBus','NameHasOwner',new GLib.Variant('(s)',[name]),null,Gio.DBusCallFlags.NO_AUTO_START,2000,null,(connection,result)=>{try{resolve(connection.call_finish(result).deep_unpack()[0]);}catch(error){reject(error);}}));
const command=argv=>new Promise((resolve,reject)=>{const child=Gio.Subprocess.new(argv,Gio.SubprocessFlags.NONE);child.wait_check_async(null,(process,result)=>{try{process.wait_check_finish(result);resolve();}catch(error){reject(error);}});});

export async function run(){
    Main.overview.hide();await Scripting.sleep(1000);
    const extension=Main.extensionManager.lookup(uuid),ext=extension?.stateObj;
    check(extension?.state===1&&ext?.host&&ext.client,'packaged extension did not enable');
    const installed=Gio.File.new_for_path(ext.path);
    check(ext.path.startsWith(`${GLib.get_user_data_dir()}/gnome-shell/extensions/`),'refusing to uninstall outside the disposable data directory');
    check(GLib.getenv('GSETTINGS_BACKEND')==='keyfile','private settings are required');
    check(typeof ext.client.setCalendarWatchers==='function','ZIP selected the wrong backend');
    check(installed.get_child('calendar-worker.js').query_exists(null),'ZIP worker is missing');
    check(!installed.get_child('tests').query_exists(null),'ZIP contains test fixtures');
    await until(()=>owned('io.github.NyongCho.LiquidWidgets.Status'),'public status bridge missing');
    check(!await owned('org.local.LiquidWidgets'),'public ZIP started the personal service');
    ext.settings.set_strv('visible',['clock','calendar','agenda','weather','system','network','media']);
    await until(()=>ext.host.states.get('system')?.status==='ok'&&ext.host.states.get('network')?.status==='ok','packaged local collectors did not publish');
    await command(['gnome-extensions','prefs',uuid]);
    let prefs;await until(()=>{prefs=global.get_window_actors().find(actor=>actor.mapped&&actor.meta_window.get_title()==='Liquid Widgets');return prefs;},'packaged preferences did not open');
    await until(()=>ext.client.watchers===1,'packaged preferences did not subscribe');
    prefs.meta_window.activate(global.get_current_time());
    await until(()=>prefs.opacity===255,'packaged preferences did not finish appearing');
    await Scripting.sleep(300); // Let GTK's initial frame and Shell's map animation paint.
    await capture('public-package-installed');
    prefs.meta_window.delete(global.get_current_time());await until(()=>ext.client.watchers===0,'packaged preferences left demand');
    const session=ext.client;Main.extensionManager.disableExtension(uuid);
    await until(()=>extension.state===2,'packaged extension did not disable');await session.drained;
    check(session.dead&&session.unwatch===null,'packaged session retained resources');
    check(!await owned('io.github.NyongCho.LiquidWidgets.Status'),'packaged status bridge survived disable');
    check(!await owned('io.github.NyongCho.LiquidWidgets.CalendarJob'),'packaged worker survived disable');
    await command(['gnome-extensions','uninstall',uuid]);
    check(!installed.query_exists(null),'uninstall retained extension files');
    GLib.file_set_contents(`${GLib.getenv('LIQUID_TEST_OUTPUT')}/package.json`,JSON.stringify({uuid,enabled:true,localCollectors:true,preferences:true,disabled:true,uninstalled:true,rustService:false}));
    print('PACKAGE_TEST: final public ZIP installed, enabled, collected, opened preferences, disabled and uninstalled without Rust');
}
