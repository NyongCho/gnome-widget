import GLib from 'gi://GLib';
import System from 'system';
import {acquireBusLease} from '../../src/data/busLease.js';
import {Cancellation} from '../../src/shared/dataClient.js';
const loop=new GLib.MainLoop(null,false);let exitCode=0;
void acquireBusLease('io.github.NyongCho.LiquidWidgets.ConfigLock',2000,new Cancellation()).then(lease=>{
    print('acquired');if(ARGV[0]==='wait'){lease.release();loop.quit();}
},()=>{exitCode=1;loop.quit();});
loop.run();System.exit(exitCode);
