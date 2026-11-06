import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
export const METRICS = {};
async function capture(name) {
    const file = Gio.File.new_for_path(`${GLib.getenv('LIQUID_TEST_OUTPUT')}/${name}.png`);
    const stream = file.replace(null,false,Gio.FileCreateFlags.PRIVATE,null);
    await new Shell.Screenshot().screenshot(false,stream);
    stream.close(null);
}
async function click(x,y) {
    const device = global.stage.get_context().get_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
    device.notify_absolute_motion(GLib.get_monotonic_time(),x,y);
    await Scripting.sleep(100);
    device.notify_button(GLib.get_monotonic_time(),Clutter.BUTTON_PRIMARY,Clutter.ButtonState.PRESSED);
    await Scripting.sleep(100);
    device.notify_button(GLib.get_monotonic_time(),Clutter.BUTTON_PRIMARY,Clutter.ButtonState.RELEASED);
    await Scripting.sleep(150);
    device.run_dispose();
}
async function drag(x,y,toX,toY) {
    const device=global.stage.get_context().get_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
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
    device.run_dispose();
}
async function displayCall(method, parameters = null) {
    return new Promise((resolve,reject)=>Gio.DBus.session.call(
        'org.gnome.Mutter.DisplayConfig','/org/gnome/Mutter/DisplayConfig',
        'org.gnome.Mutter.DisplayConfig',method,parameters,null,Gio.DBusCallFlags.NONE,
        10000,null,(bus,result)=>{try{resolve(bus.call_finish(result).deep_unpack());}catch(e){reject(e);}}));
}
async function setScale(scale) {
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
async function enable(uuid) {
    if (!Main.extensionManager.enableExtension(uuid)) throw new Error(`extension unavailable: ${uuid}`);
    await Scripting.sleep(1800);
    const extension=Main.extensionManager.lookup(uuid);
    if (extension.state !== 1) throw new Error(`extension failed: ${uuid} state=${extension.state} ${extension.error}`);
}
export async function run() {
    Main.overview.hide();
    await Scripting.sleep(1000);
    const extension = Main.extensionManager.lookup((GLib.getenv('LIQUID_TEST_UUID')||'liquid-widgets@local'));
    if (!extension?.stateObj) throw new Error('Liquid Widgets extension did not load');
    const labels=extension.stateObj.surface.actor.get_children().filter(child=>child.get_text);
    if (!labels.some(label=>label.get_text()==='사용자 서비스를 설치·시작해 주세요')) throw new Error('missing service installation hint');
    extension.stateObj.layer.actor.hide();
    await Scripting.sleep(200);
    await capture('background');
    extension.stateObj.layer.actor.show();
    extension.stateObj.setStrength(0);
    await Scripting.sleep(500);
    await capture('glass-off');
    extension.stateObj.setStrength(16);
    await Scripting.sleep(500);
    await capture('glass-on');
    await click(500,370);
    if (extension.stateObj.clickCount !== 1) throw new Error('card button did not receive virtual pointer click');
    const before = new Set(global.get_window_actors());
    await Scripting.createTestWindow({width:420,height:300});
    await Scripting.waitTestWindows();
    await Scripting.sleep(300);
    const window = global.get_window_actors().find(actor=>!before.has(actor))?.meta_window;
    if (!window) throw new Error('test window did not appear');
    window.move_resize_frame(false,400,180,420,300);
    await Scripting.sleep(300);
    await click(500,370);
    if (extension.stateObj.clickCount !== 1) throw new Error('widget intercepted an overlapping application window');
    await capture('window-overlap');
    await Scripting.destroyTestWindows();
    await Scripting.sleep(300);
    await click(500,370);
    if (extension.stateObj.clickCount !== 2) throw new Error('card did not recover after window closed');
    const initialPaints=extension.stateObj.diagnostics.inputPaints;
    extension.stateObj.setStrength(0); // Changes button text from on to off and the output uniform only.
    await Scripting.sleep(200);
    if (extension.stateObj.diagnostics.inputPaints !== initialPaints) throw new Error('foreground update invalidated wallpaper cache');
    extension.stateObj.setStrength(16);
    const settings=new Gio.Settings({schema_id:'org.gnome.desktop.background'});
    const alternate=Gio.File.new_for_path(`${GLib.getenv('LIQUID_TEST_OUTPUT')}/background-alternate.svg`).get_uri();
    settings.set_string('picture-uri',alternate); settings.set_string('picture-uri-dark',alternate);
    await Scripting.sleep(1500);
    await capture('wallpaper-changed');
    if (extension.stateObj.diagnostics.inputPaints <= initialPaints) throw new Error('wallpaper change left stale cache');
    print('LIQUID_TEST: wallpaper reload and foreground cache separation passed');
    await setScale(1.25);
    await capture('fractional-125');
    print(`LIQUID_TEST: fractional scale 1.25 ${JSON.stringify(extension.stateObj.diagnostics)}`);
    await setScale(1);
    Main.overview.show(); await Scripting.sleep(600);
    if (extension.stateObj.layer.actor.visible) throw new Error('card remains visible in overview');
    Main.overview.hide(); await Scripting.sleep(600);
    if (!extension.stateObj.layer.actor.visible) throw new Error('card failed to return from overview');
    global.workspace_manager.get_workspace_by_index(1).activate(global.get_current_time());
    await Scripting.sleep(700);
    await click(500,370);
    if (extension.stateObj.clickCount !== 3) throw new Error('card missing on second workspace');
    global.workspace_manager.get_workspace_by_index(0).activate(global.get_current_time());
    await Scripting.sleep(700);
    await enable('ding@rastersoft.com');
    await capture('ding-enabled');
    const desktop=global.window_group.get_children().find(a=>a instanceof Meta.WindowActor && a.meta_window.get_gtk_application_id()==='com.rastersoft.ding');
    if (!desktop) throw new Error('DING desktop window missing');
    const children=global.window_group.get_children();
    if (children.indexOf(extension.stateObj.layer.actor) <= children.indexOf(desktop)) throw new Error('card is below DING desktop window');
    print(`LIQUID_PICK_BEFORE: ${global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE,500,370)} button=${extension.stateObj.button} count=${extension.stateObj.clickCount}`);
    await click(500,370);
    print(`LIQUID_PICK_AFTER: ${global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE,500,370)} count=${extension.stateObj.clickCount}`);
    if (extension.stateObj.clickCount !== 4) throw new Error('DING intercepts card click');
    await click(64,74);
    await capture('icon-selected');
    await drag(64,74,270,160);
    await capture('icon-dragged');
    if (extension.stateObj.clickCount !== 4) throw new Error('desktop input reached the card');
    // Ordinary windows must still be above the card with DING enabled.
    const dingBefore=new Set(global.get_window_actors());
    await Scripting.createTestWindow({width:420,height:300});
    await Scripting.waitTestWindows(); await Scripting.sleep(300);
    const app=global.get_window_actors().find(a=>!dingBefore.has(a));
    if (!app) throw new Error('DING coexistence application window missing');
    app.meta_window.move_resize_frame(false,400,180,420,300);
    await Scripting.sleep(300); await click(500,370);
    if (extension.stateObj.clickCount !== 4) throw new Error('DING restacking put card above application');
    await capture('ding-window-overlap');
    await Scripting.destroyTestWindows(); await Scripting.sleep(300);
    await enable('blur-my-shell@aunetx');
    await capture('blur-my-shell');
    await click(500,370);
    if (extension.stateObj.clickCount !== 5) throw new Error('Blur my Shell conflicts with card click');
    const daemon=Gio.Subprocess.new([GLib.getenv('LIQUID_TEST_DAEMON')],Gio.SubprocessFlags.NONE);
    try {
        for(let attempt=0;attempt<50 && !labels.some(label=>label.get_text()==='데이터 서비스 연결됨');attempt++) await Scripting.sleep(100);
        if(!labels.some(label=>label.get_text()==='데이터 서비스 연결됨')) throw new Error('GNOME did not connect to the Rust service');
        await capture('service-connected');
    } finally {daemon.force_exit();}
    await Scripting.sleep(Number(GLib.getenv('LIQUID_HOLD_MS') || 0));
    print(`LIQUID_TEST: desktop coexistence passed ${JSON.stringify(extension.stateObj.diagnostics)}`);
}
