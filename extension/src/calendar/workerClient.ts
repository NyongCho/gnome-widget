import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {Cancellation} from '../shared/dataClient.js';
import type {CalendarData} from '../types.js';
import {waitBusNameFree,CancelledError} from '../data/busLease.js';
import {CONTROL_LIMIT,INPUT_LIMIT,REPLY_LIMIT,encodeFrame,parseControl,parseHeader,parseReply,ProtocolFailure,type CalendarJob} from './protocol.js';
import {readFrame,writeBytes,expectEof,closeStream,TruncatedFrameError} from './streams.js';

interface Request {job:CalendarJob;cancel:Cancellation;unlink:()=>void;resolve:(data:CalendarData)=>void;reject:(error:unknown)=>void}
/** Overrides are used by the isolated process harness, never by settings or network data. */
interface WorkerOptions {argv?:string[];watchdogMs?:number;busyTimeoutMs?:number}
export class CalendarWorkerClient {
    private active:Request|null=null;
    private pending:Request|null=null;
    private pump:Promise<void>|null=null;
    private disposed=false;
    constructor(private directory:string,private options:WorkerOptions={}){}
    run(job:CalendarJob,cancel:Cancellation):Promise<CalendarData> {
        if(this.disposed)return Promise.reject(new ProtocolFailure('SERVICE_UNAVAILABLE'));
        if(cancel.cancelled)return Promise.reject(new CancelledError());
        try{parseHeader(job.header);encodeFrame(job.header,CONTROL_LIMIT);if(job.ics.byteLength>INPUT_LIMIT)throw new ProtocolFailure('PAYLOAD_TOO_LARGE');}
        catch(error){return Promise.reject(error);}
        return new Promise((resolve,reject)=>{
            const internal=new Cancellation();
            const request:Request={job,cancel:internal,unlink:cancel.onCancel(()=>internal.cancel()),resolve,reject};
            if(this.pending){this.pending.cancel.cancel();this.pending.unlink();this.pending.reject(new CancelledError());}
            this.pending=request;this.active?.cancel.cancel();
            if(!this.pump){const pump=this.drain();this.pump=pump;void pump.finally(()=>{if(this.pump===pump){this.pump=null;this.resumePending();}});}
        });
    }
    private resumePending():void {
        if(this.pending&&!this.disposed&&!this.pump){
            const pump=this.drain();this.pump=pump;
            void pump.finally(()=>{if(this.pump===pump){this.pump=null;this.resumePending();}});
        }
    }
    async dispose():Promise<void> {
        this.disposed=true;
        if(this.pending){this.pending.cancel.cancel();this.pending.unlink();this.pending.reject(new CancelledError());this.pending=null;}
        this.active?.cancel.cancel();await this.pump;
    }
    private async drain():Promise<void> {
        while(this.pending){const request=this.pending;this.pending=null;this.active=request;
            try{const data=await this.execute(request);if(request.cancel.cancelled)throw new CancelledError();request.resolve(data);}
            catch(error){request.reject(request.cancel.cancelled?new CancelledError():error);}
            finally{request.unlink();this.active=null;}
        }
    }
    private async execute(request:Request):Promise<CalendarData> {
        const busyDeadline=GLib.get_monotonic_time()+(this.options.busyTimeoutMs??30000)*1000;
        for(;;){if(request.cancel.cancelled)throw new CancelledError();
            const result=await this.spawn(request);
            if(result!==null)return result;
            const remaining=Math.ceil((busyDeadline-GLib.get_monotonic_time())/1000);
            if(remaining<=0)throw new ProtocolFailure('SERVICE_UNAVAILABLE');
            try{await waitBusNameFree('io.github.NyongCho.LiquidWidgets.CalendarJob',remaining,request.cancel);}
            catch{if(request.cancel.cancelled)throw new CancelledError();throw new ProtocolFailure('SERVICE_UNAVAILABLE');}
        }
    }
    private async spawn(request:Request):Promise<CalendarData|null> {
        let child:Gio.Subprocess;
        try{child=Gio.Subprocess.new(this.options.argv??['gjs','-m',`${this.directory}/calendar-worker.js`],
            Gio.SubprocessFlags.STDIN_PIPE|Gio.SubprocessFlags.STDOUT_PIPE|Gio.SubprocessFlags.STDERR_SILENCE);}
        catch{throw new ProtocolFailure('SERVICE_UNAVAILABLE');}
        const input=child.get_stdin_pipe()!,output=child.get_stdout_pipe()!,io=new Gio.Cancellable();
        let exited=false,timedOut=false;
        const pendingIO:Promise<unknown>[]=[];
        // wait_async is deliberately uncancelled: request cancellation is not proof of exit.
        const reaped=new Promise<boolean>(resolve=>child.wait_async(null,(source,result)=>{
            try{source!.wait_finish(result);exited=true;resolve(source!.get_if_exited()&&source!.get_exit_status()===0);}catch{exited=true;resolve(false);}
        }));
        const kill=()=>{if(!exited)child.force_exit();io.cancel();};
        const unlisten=request.cancel.onCancel(kill);
        const timer=GLib.timeout_add(GLib.PRIORITY_DEFAULT,this.options.watchdogMs??10000,()=>{timedOut=true;kill();return GLib.SOURCE_REMOVE;});
        try{
            const control=parseControl(await readFrame(output,CONTROL_LIMIT,io));
            if(control==='busy'){
                await closeStream(input);await expectEof(output,io);
                if(!await reaped)throw new ProtocolFailure('SERVICE_UNAVAILABLE');return null;
            }
            const write=async()=>{
                await writeBytes(input,encodeFrame(request.job.header,CONTROL_LIMIT),io);
                const prefix=new Uint8Array(4);new DataView(prefix.buffer).setUint32(0,request.job.ics.byteLength,false);
                await writeBytes(input,prefix,io);await writeBytes(input,request.job.ics,io);await closeStream(input);
            };
            const read=async()=>{const reply=await readFrame(output,REPLY_LIMIT,io);await expectEof(output,io);return reply;};
            const writer=write(),reader=read();pendingIO.push(writer,reader);
            const [,reply]=await Promise.all([writer,reader]);
            if(!await reaped)throw new ProtocolFailure('SERVICE_UNAVAILABLE');
            if(request.cancel.cancelled)throw new CancelledError();
            return parseReply(reply,request.job.header);
        }catch(error){
            const crashed=error instanceof TruncatedFrameError&&!await reaped;
            if(request.cancel.cancelled)throw new CancelledError();
            if(timedOut)throw new ProtocolFailure('EXPANSION_LIMIT');
            if(crashed)throw new ProtocolFailure('SERVICE_UNAVAILABLE');
            if(error instanceof ProtocolFailure)throw error;
            throw new ProtocolFailure('SERVICE_UNAVAILABLE');
        }finally{
            unlisten();if(!timedOut)GLib.source_remove(timer);kill();await reaped;await Promise.allSettled(pendingIO);
            await Promise.all([closeStream(input),closeStream(output)]);
        }
    }
}
