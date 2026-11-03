import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

export async function capture(name) {
    const file = Gio.File.new_for_path(`${GLib.getenv('LIQUID_TEST_OUTPUT')}/${name}.png`);
    const stream = file.replace(null,false,Gio.FileCreateFlags.PRIVATE,null);
    await new Shell.Screenshot().screenshot(false,stream);
    stream.close(null);
}
// Reuse one mouse across gestures, like a physical device. Repeatedly removing
// the seat's pointer between presses introduces device-hotplug/focus races.
let pointer=null;
function mouse(){return pointer??=global.stage.get_context().get_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);}
export function releaseInput(){pointer?.run_dispose();pointer=null;}
export async function click(x,y) {
    const device = mouse();
    device.notify_absolute_motion(GLib.get_monotonic_time(),x,y);
    await Scripting.sleep(100);
    device.notify_button(GLib.get_monotonic_time(),Clutter.BUTTON_PRIMARY,Clutter.ButtonState.PRESSED);
    await Scripting.sleep(100);
    device.notify_button(GLib.get_monotonic_time(),Clutter.BUTTON_PRIMARY,Clutter.ButtonState.RELEASED);
    await Scripting.sleep(150);
}
export async function drag(x,y,toX,toY) {
    const device=mouse();
    device.notify_absolute_motion(GLib.get_monotonic_time(),x,y);
    await Scripting.sleep(100);
    device.notify_button(GLib.get_monotonic_time(),Clutter.BUTTON_PRIMARY,Clutter.ButtonState.PRESSED);
    await Scripting.sleep(150);
    for (let step=1;step<=20;step++) {
        device.notify_absolute_motion(GLib.get_monotonic_time(),x+(toX-x)*step/20,y+(toY-y)*step/20);
        await Scripting.sleep(35);
    }
    device.notify_button(GLib.get_monotonic_time(),Clutter.BUTTON_PRIMARY,Clutter.ButtonState.RELEASED);
    await Scripting.sleep(500);
}
export async function displayCall(method, parameters = null) {
    return new Promise((resolve,reject)=>Gio.DBus.session.call(
        'org.gnome.Mutter.DisplayConfig','/org/gnome/Mutter/DisplayConfig',
        'org.gnome.Mutter.DisplayConfig',method,parameters,null,Gio.DBusCallFlags.NONE,
        10000,null,(bus,result)=>{try{resolve(bus.call_finish(result).deep_unpack());}catch(e){reject(e);}}));
}
export async function setScale(scale) {
    const [serial,monitors] = await displayCall('GetCurrentState');
    const connector = monitors[0][0][0];
    const mode = monitors[0][1].find(mode=>mode[6]['is-current']?.get_boolean());
    if (!mode || !mode[5].includes(scale)) throw new Error(`unsupported test scale ${scale}`);
    await displayCall('ApplyMonitorsConfig',new GLib.Variant('(uua(iiduba(ssa{sv}))a{sv})',
        [serial,1,[[0,0,scale,0,true,[[connector,mode[0],{}]]]],{}]));
    await Scripting.sleep(800);
    const state = await displayCall('GetCurrentState');
    if (state[2][0][2] !== scale) throw new Error('monitor scale did not change');
}
export async function enable(uuid) {
    if (!Main.extensionManager.enableExtension(uuid)) throw new Error(`extension unavailable: ${uuid}`);
    await Scripting.sleep(1800);
    const extension=Main.extensionManager.lookup(uuid);
    if (extension.state !== 1) throw new Error(`extension failed: ${uuid} state=${extension.state} ${extension.error}`);
}
