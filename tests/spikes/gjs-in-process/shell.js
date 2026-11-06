// Runs inside a disposable GNOME Shell, never the logged-in Shell.
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import {benchmark,activePhase,smoke,here} from './probe.js';
export const METRICS={};
export async function run(){
    Main.overview.hide();await Scripting.sleep(1200);
    const ext=Main.extensionManager.lookup('liquid-widgets@local');
    if(!ext?.stateObj?.host)throw new Error('Test widget extension missing');
    const state=ext.stateObj;
    state.settings.set_strv('visible',['clock','calendar','weather','agenda','system','network','media']);
    await Scripting.sleep(150);
    state.client.stop();state.clock.destroy(); // Only synthetic states, no daemon or real feeds.
    const snapshot=JSON.parse(new TextDecoder().decode(GLib.file_get_contents(`${here}/../../fixtures/protocol/snapshot-valid.json`)[1]));
    snapshot.media={status:'ok',sourceId:null,updatedAt:'2026-11-03T03:00:00Z',errorCode:null,data:{player:'test',status:'playing',title:'Synthetic track',artist:'Fixture',artUri:null}};
    state.host.tick(Date.parse('2026-11-03T00:00:00Z'),'Asia/Seoul',false,'ko-KR',1);
    for(const name of ['calendar','weather','system','network','media'])state.host.updateProvider(name,snapshot[name]);
    state.host.setConnected(true);state.layout();
    const label=new St.Label({text:'GJS in-process feasibility — synthetic data',style:'background: #173c58; color: white; padding: 18px;',x:20,y:220});
    Main.uiGroup.add_child(label);
    const timeline=Clutter.Timeline.new_for_actor(label,60000);
    let last=null;
    const id=timeline.connect('new-frame',()=>{
        const current=GLib.get_monotonic_time()/1000;
        if(last!==null&&activePhase)activePhase.frames.push(current-last);
        last=current;label.translation_x=150*Math.sin(timeline.get_progress()*Math.PI*2);
    });
    timeline.start();await Scripting.sleep(500);
    try{
        const report={runtime:'GNOME Shell 50.1 nested Wayland; existing seven-card UI, synthetic data; no backend process',capabilities:await smoke(),benchmarks:await benchmark(5,row=>{
            if(!row.frames)throw new Error(`No frames: playing=${timeline.is_playing()}, mapped=${label.mapped}, stage=${global.stage.mapped}`);
            print(`IN_PROCESS: ${JSON.stringify(row)}`);
        })};
        GLib.file_set_contents(`${here}/results/shell.json`,JSON.stringify(report,null,2));
        print('IN_PROCESS_SPIKE_COMPLETE');
    }finally{timeline.stop();timeline.disconnect(id);label.destroy();}
}
export function finish(){}
