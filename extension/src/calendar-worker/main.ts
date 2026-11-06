import Gio from 'gi://Gio';
import GioUnix from 'gi://GioUnix?version=2.0';
import GLib from 'gi://GLib';
import System from 'system';
import {Cancellation} from '../shared/dataClient.js';
import {acquireBusLease,LeaseBusyError,type BusLease} from '../data/busLease.js';
import {CONTROL_LIMIT,INPUT_LIMIT,REPLY_LIMIT,frameLength,parseHeader,parseReply,ProtocolFailure,type CalendarJobHeader} from '../calendar/protocol.js';
import {readExact,readFrame,expectEof,writeFrame,closeStream} from '../calendar/streams.js';
import {createBudget,CalendarFailure} from './budget.js';

let exitCode=0;
const deadline=GLib.get_monotonic_time()+9_000_000;
const timer=GLib.timeout_add(GLib.PRIORITY_DEFAULT,9000,()=>{System.exit(2);return GLib.SOURCE_REMOVE;});
const input=new GioUnix.InputStream({fd:0,close_fd:true});
const output=new GioUnix.OutputStream({fd:1,close_fd:true});
const io=new Gio.Cancellable();
let lease:BusLease|null=null,header:CalendarJobHeader|null=null;
const loop=new GLib.MainLoop(null,false);
async function run():Promise<void> {
    try{lease=await acquireBusLease('io.github.NyongCho.LiquidWidgets.CalendarJob',0,new Cancellation());}
    catch(error){if(error instanceof LeaseBusyError){await writeFrame(output,{version:1,state:'busy'},CONTROL_LIMIT,io);return;}throw error;}
    await writeFrame(output,{version:1,state:'ready'},CONTROL_LIMIT,io);
    header=parseHeader(await readFrame(input,CONTROL_LIMIT,io));
    const size=frameLength(await readExact(input,4,io),INPUT_LIMIT);
    const bytes=await readExact(input,size,io);await expectEof(input,io);await closeStream(input);
    let text:string;
    try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new ProtocolFailure('INVALID_DATA');}
    // This split module initializes the calendar library and full time zone data
    // only after this worker owns the session-wide computing lease.
    const {expandCalendar}=await import('./engine.js');
    const data=expandCalendar(text,header.context,header.now,createBudget(deadline));
    const reply={version:1,jobId:header.jobId,sourceId:header.sourceId,generation:header.generation,ok:true,data};
    parseReply(reply,header);await writeFrame(output,reply,REPLY_LIMIT,io);
}
void run().catch(async error=>{
    if(!header)throw error;
    const errorCode=error instanceof CalendarFailure||error instanceof ProtocolFailure?error.code:'INVALID_DATA';
    await writeFrame(output,{version:1,jobId:header.jobId,sourceId:header.sourceId,generation:header.generation,ok:false,errorCode},REPLY_LIMIT,io);
}).then(async()=>{await closeStream(output);lease?.release();GLib.source_remove(timer);loop.quit();},()=>{lease?.release();exitCode=2;loop.quit();});
loop.run();
System.exit(exitCode);
