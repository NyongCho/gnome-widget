import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GioUnix from 'gi://GioUnix?version=2.0';
import System from 'system';
import {CONTROL_LIMIT,INPUT_LIMIT,REPLY_LIMIT,parseHeader,frameLength,encodeFrame} from '../../src/calendar/protocol.js';
import {readFrame,readExact,expectEof,writeFrame,writeBytes,closeStream} from '../../src/calendar/streams.js';
const mode=ARGV[0],input=new GioUnix.InputStream({fd:0,close_fd:true}),output=new GioUnix.OutputStream({fd:1,close_fd:true});
const cancel=new Gio.Cancellable(),loop=new GLib.MainLoop(null,false);
let exitCode=0;
async function run():Promise<void>{
    if(mode==='controloversize'){await writeBytes(output,new Uint8Array([255,255,255,255]),cancel);return;}
    await writeFrame(output,{version:1,state:'ready'},CONTROL_LIMIT,cancel);
    const header=parseHeader(await readFrame(input,CONTROL_LIMIT,cancel));
    const size=frameLength(await readExact(input,4,cancel),INPUT_LIMIT);await readExact(input,size,cancel);await expectEof(input,cancel);
    const reply={version:1,jobId:header.jobId,sourceId:header.sourceId,generation:header.generation,ok:true,data:{...header.context,events:[]}};
    if(mode==='crash'){exitCode=3;return;}
    if(mode==='exactreply'){const body=new TextEncoder().encode(JSON.stringify(reply));const framed=new Uint8Array(REPLY_LIMIT+4);new DataView(framed.buffer).setUint32(0,REPLY_LIMIT,false);framed.fill(32,4);framed.set(body,4);await writeBytes(output,framed,cancel);return;}
    if(mode==='slow'){await new Promise<void>(resolve=>GLib.timeout_add(GLib.PRIORITY_DEFAULT,60000,()=>{resolve();return GLib.SOURCE_REMOVE;}));return;}
    if(mode==='oversize'){await writeBytes(output,new Uint8Array([255,255,255,255]),cancel);}
    else if(mode==='utf8'){await writeBytes(output,new Uint8Array([0,0,0,2,0xc3,0x28]),cancel);}
    else if(mode==='truncated'){await writeBytes(output,encodeFrame(reply,REPLY_LIMIT).subarray(0,7),cancel);}
    else {if(mode==='wrongjob')reply.jobId='older';await writeFrame(output,reply,REPLY_LIMIT,cancel);if(mode==='extra')await writeFrame(output,reply,REPLY_LIMIT,cancel);}
    await closeStream(output);
    if(mode==='hang')await new Promise<void>(resolve=>GLib.timeout_add(GLib.PRIORITY_DEFAULT,60000,()=>{resolve();return GLib.SOURCE_REMOVE;}));
    if(mode==='nonzero')exitCode=3;
}
void run().then(()=>loop.quit(),error=>{printerr(String(error));exitCode=2;loop.quit();});loop.run();System.exit(exitCode);
