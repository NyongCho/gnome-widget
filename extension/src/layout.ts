import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {selectMonitor} from './shared/layout.js';
export function desktopWorkarea(selected:string):{index:number;area:{x:number;y:number;width:number;height:number}}|null{
    const manager=global.backend.get_monitor_manager();
    const hardware=manager.get_monitors()??[];
    const index=selectMonitor(selected,Main.layoutManager.monitors.map(m=>({id:hardware.find(h=>manager.get_monitor_for_connector(h.get_connector())===m.index)?.get_connector()??String(m.index),primary:m.index===Main.layoutManager.primaryIndex})));
    if(index<0)return null;
    const monitor=Main.layoutManager.monitors[index]!;
    const area=global.workspace_manager.get_active_workspace().get_work_area_for_monitor(monitor.index);
    return{index:monitor.index,area:{x:area.x,y:area.y,width:area.width,height:area.height}};
}
export function watchDesktopLayout(callback:()=>void):()=>void{
    const monitors=Main.layoutManager.connect('monitors-changed',callback);
    const workarea=global.display.connect('workareas-changed',callback);
    return()=>{Main.layoutManager.disconnect(monitors);global.display.disconnect(workarea);};
}
