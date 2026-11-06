import {Cancellation} from '../../shared/dataClient.js';
import type {ProviderMap,SystemData} from '../../types.js';
import type {LinuxFiles} from '../contracts.js';
import {DataFailure,DataCancelled} from '../errors.js';
import type {ProviderContext,ProviderDriver} from '../scheduler.js';
import type {SessionClock} from '../localSession.js';
const U64=(1n<<64n)-1n,SAFE=BigInt(Number.MAX_SAFE_INTEGER);
export function unsigned(text:string):bigint{if(!/^\d+$/.test(text)||text.length>20)throw new DataFailure('INVALID_DATA');const value=BigInt(text);if(value>U64)throw new DataFailure('INVALID_DATA');return value;}
export class SystemSampler {
    private previous:{total:bigint;idle:bigint}|null=null;
    reset():void{this.previous=null;}
    sample(stat:string,mem:string,temperature:number|null):SystemData {
        const line=stat.split('\n').find(value=>value.startsWith('cpu '));if(!line)throw new DataFailure('INVALID_DATA');
        const fields=line.trim().split(/\s+/).slice(1,9).map(unsigned);if(fields.length<4)throw new DataFailure('INVALID_DATA');
        const total=fields.reduce((sum,n)=>sum+n,0n),idle=fields[3]!+(fields[4]??0n);if(total>U64||idle>U64)throw new DataFailure('INVALID_DATA');
        let cpuPercent:number|null=null;
        if(this.previous){const elapsed=total-this.previous.total,idleDelta=idle-this.previous.idle;if(elapsed>0n&&idleDelta>=0n&&idleDelta<=elapsed)cpuPercent=100*Number(elapsed-idleDelta)/Number(elapsed);}
        this.previous={total,idle};
        const memory=(key:string)=>{const line=mem.split('\n').find(line=>line.startsWith(key));const fields=line?.trim().split(/\s+/);if(!fields?.[1]||fields[2]!=='kB')throw new DataFailure('INVALID_DATA');const bytes=unsigned(fields[1])*1024n;if(bytes>SAFE)throw new DataFailure('INVALID_DATA');return Number(bytes);};
        const memoryTotalBytes=memory('MemTotal:'),available=memory('MemAvailable:');if(!memoryTotalBytes||available>memoryTotalBytes)throw new DataFailure('INVALID_DATA');
        return{cpuPercent,memoryTotalBytes,memoryUsedBytes:memoryTotalBytes-available,temperatureC:temperature};
    }
}
async function mapLimit<T,R>(items:T[],limit:number,fn:(item:T)=>Promise<R>):Promise<R[]>{const output:R[]=new Array(items.length);let index=0;await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{for(;;){const current=index++;if(current>=items.length)return;output[current]=await fn(items[current]!);}}));return output;}
export async function readTemperature(files:LinuxFiles,cancel:Cancellation):Promise<number|null>{
    try{
        const devices=await files.listNames('/sys/class/hwmon',64,cancel);
        const groups=await mapLimit(devices.filter(name=>/^hwmon\d+$/.test(name)),4,async name=>{
            const directory=`/sys/class/hwmon/${name}`,sensors:{priority:number;value:number}[]=[];
            try{
                const chip=(await files.readText(`${directory}/name`,1024,cancel)).trim();if(chip!=='coretemp'&&chip!=='k10temp')return sensors;
                const names=await files.listNames(directory,256,cancel);
                // At most four device tasks; each device reads its sensors serially.
                for(const labelFile of names.filter(name=>/^temp\d+_label$/.test(name))){
                    if(cancel.cancelled)throw new DataCancelled();
                    try{const label=(await files.readText(`${directory}/${labelFile}`,1024,cancel)).trim();
                        const priority=chip==='coretemp'?(label.startsWith('Package id ')?0:label.startsWith('Core ')?2:null):(label==='Tdie'?0:label==='Tctl'?1:null);if(priority===null)continue;
                        const raw=(await files.readText(`${directory}/${labelFile.replace('_label','_input')}`,128,cancel)).trim(),value=Number(raw)/1000;
                        if(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw)&&Number.isFinite(value)&&value>=-40&&value<=150)sensors.push({priority,value});
                    }catch{/* Missing or unreadable sensors are optional. */}
                }
            }catch{/* A disappearing hwmon device does not disable CPU/RAM. */}return sensors;
        });
        const sensors=groups.flat();if(!sensors.length)return null;const priority=Math.min(...sensors.map(sensor=>sensor.priority));return Math.max(...sensors.filter(sensor=>sensor.priority===priority).map(sensor=>sensor.value));
    }catch{return null;}
}
export class SystemProvider implements ProviderDriver<'system'> {
    private sampler=new SystemSampler();private temperature:number|null=null;private measured=-Infinity;
    constructor(private files:LinuxFiles,private clock:SessionClock,private sensor=(cancel:Cancellation)=>readTemperature(files,cancel)){}
    reset():void{this.sampler.reset();}
    private async updateTemperature(cancel:Cancellation):Promise<void>{
        const now=this.clock.monotonic();if(now-this.measured<5000)return;this.measured=now;
        const local=new Cancellation(),unlink=cancel.onCancel(()=>local.cancel());let stop=()=>{},unlisten=()=>{};
        const deadline=new Promise<null>(resolve=>{unlisten=local.onCancel(()=>resolve(null));stop=this.clock.schedule(1500,()=>{local.cancel();resolve(null);});});
        try{const value=await Promise.race([this.sensor(local).catch(()=>null),deadline]);if(!cancel.cancelled)this.temperature=value;}
        finally{stop();unlink();unlisten();local.cancel();}
    }
    async collect(context:ProviderContext):Promise<ProviderMap['system']>{
        const cancel=new Cancellation(),unlink=context.cancel.onCancel(()=>cancel.cancel());
        try{
            const [stat,mem]=await Promise.all([this.files.readText('/proc/stat',128*1024,cancel),this.files.readText('/proc/meminfo',64*1024,cancel),this.updateTemperature(cancel)]);
            if(cancel.cancelled)throw new DataCancelled();const data=this.sampler.sample(stat,mem,this.temperature);
            return{status:'ok',sourceId:'system',updatedAt:context.now,data,errorCode:null};
        }finally{unlink();cancel.cancel();}
    }
}
