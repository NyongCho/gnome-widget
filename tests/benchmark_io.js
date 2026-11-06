import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';
import {selectFixture} from './gnome/benchmark-io.js';

const directory=GLib.dir_make_tmp('liquid-benchmark-io-XXXXXX');
const loop=new GLib.MainLoop(null,false);let failure=null;
async function test(){
    await selectFixture(directory,'1k');
    let yielded=false;
    const tick=GLib.idle_add(GLib.PRIORITY_HIGH,()=>{yielded=true;return GLib.SOURCE_REMOVE;});
    try{
        await selectFixture(directory,'10k');
        if(!yielded)throw new Error('fixture replacement blocks the main-loop turn');
        const contents=new TextDecoder().decode(GLib.file_get_contents(`${directory}/selection.txt`)[1]);
        if(contents!=='10k')throw new Error('refresh would read the wrong fixture');
        print('PASS fixture replacement yields to the main loop and completes before refresh');
    }finally{if(!yielded)GLib.Source.remove(tick);}
}
test().catch(error=>{failure=error;}).finally(()=>loop.quit());loop.run();
Gio.File.new_for_path(`${directory}/selection.txt`).delete(null);Gio.File.new_for_path(directory).delete(null);
if(failure){printerr(failure);System.exit(1);}
