import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
export const METRICS={};
function check(value,message){if(!value)throw new Error(message);}
export async function run(){
    Main.overview.hide();await Scripting.sleep(500);
    const uuid=GLib.getenv('LIQUID_TEST_UUID'),ext=Main.extensionManager.lookup(uuid)?.stateObj;
    check(ext?.clock,'extension clock missing');
    const Clock=ext.clock.constructor,shared=Main.panel.statusArea.dateMenu._clock;
    const context=GLib.MainContext.default(),held=[];
    for(let cycle=0;cycle<20;cycle++){
        // No main-loop dispatch between markers: only this constructor/start can
        // attach sources here. Retain the controller so GC cannot hide a leak.
        const before=GLib.idle_add(GLib.PRIORITY_DEFAULT,()=>GLib.SOURCE_REMOVE);
        const clock=new Clock();held.push(clock);let ticks=0;
        clock.start(()=>ticks++);
        const minute=clock.timer;
        const after=GLib.idle_add(GLib.PRIORITY_DEFAULT,()=>GLib.SOURCE_REMOVE);
        GLib.source_remove(before);GLib.source_remove(after);
        check(ticks===1&&context.find_source_by_id(minute),'clock did not start');
        const previous=ticks;shared.notify('clock');shared.notify('timezone');
        // The old implementation listens to its own WallClock, so check the
        // notification behavior only after the teardown regression below.
        const notifications=ticks-previous;
        clock.destroy();
        const remaining=[];
        for(let id=before+1;id<after;id++){
            const source=context.find_source_by_id(id);
            if(source)remaining.push({id,name:source.get_name(),priority:source.get_priority()});
        }
        check(remaining.length===0,`clock retained native sources after destroy: ${JSON.stringify(remaining)}`);
        check(!context.find_source_by_id(minute),'clock retained minute timer');
        check(notifications===2,'clock/timezone changes were not forwarded');
        const stopped=ticks;shared.notify('clock');shared.notify('timezone');
        check(ticks===stopped,'clock callback survived destroy');
        check(shared.get_timezone().get_identifier()===clock.timeZone,'shared Shell clock was disposed');
    }
    check(held.length===20,'controllers were not retained');
    print('CLOCK_LIFECYCLE: 20 retained controllers leave zero sources/listeners; shared clock and timezone notifications remain usable');
}
