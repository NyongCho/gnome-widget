import type {Cancellation} from '../../shared/dataClient.js';
import type {NetworkData,ProviderMap} from '../../types.js';
import type {LinuxFiles} from '../contracts.js';
import {DataFailure,DataCancelled} from '../errors.js';
import type {ProviderContext,ProviderDriver} from '../scheduler.js';
import {providerSource} from '../state.js';
import {unsigned} from './system.js';
function validName(name:string):boolean{return /^[a-zA-Z0-9_.:-]{1,15}$/.test(name);}
export function defaultInterface(ipv4:string,ipv6:string):string|null {
    const candidates:{metric:number;name:string}[]=[];
    const automatic=(name:string)=>validName(name)&&name!=='lo'&&!name.startsWith('tailscale');
    for(const line of ipv4.split('\n').slice(1)){const f=line.trim().split(/\s+/);if(f.length<8||f[1]!=='00000000'||f[7]!=='00000000'||!automatic(f[0]!))continue;
        if(!/^[0-9a-f]{1,8}$/i.test(f[3]!)||!/^\d+$/.test(f[6]!))continue;const flags=parseInt(f[3]!,16),metric=Number(f[6]);if((flags&1)&&metric<=0xffffffff)candidates.push({metric,name:f[0]!});}
    if(!candidates.length)for(const line of ipv6.split('\n')){const f=line.trim().split(/\s+/);if(f.length!==10||f[0]!=='00000000000000000000000000000000'||f[1]!=='00'||!automatic(f[9]!))continue;
        if(!/^[0-9a-f]{1,8}$/i.test(f[8]!)||!/^([0-9a-f]{1,8})$/i.test(f[5]!))continue;const flags=parseInt(f[8]!,16),metric=parseInt(f[5]!,16);if((flags&1)&&!(flags&0x200))candidates.push({metric,name:f[9]!});}
    candidates.sort((a,b)=>a.metric-b.metric||(a.name<b.name?-1:a.name>b.name?1:0));return candidates[0]?.name??null;
}
export class NetworkSampler {
    private previous:{name:string;rx:bigint;tx:bigint;time:number}|null=null;
    private history:{time:number;at:string;rx:number;tx:number}[]=[];
    reset():void{this.previous=null;this.history=[];}
    sample(name:string,rx:bigint,tx:bigint,time:number,at:string):NetworkData{
        let rates:{rx:number;tx:number}|null=null;
        if(this.previous?.name===name){const seconds=(time-this.previous.time)/1000,rxDelta=rx-this.previous.rx,txDelta=tx-this.previous.tx;
            if(seconds>0&&rxDelta>=0n&&txDelta>=0n){const rx=Number(rxDelta)/seconds,tx=Number(txDelta)/seconds;if(Number.isFinite(rx)&&Number.isFinite(tx)&&rx<=Number.MAX_SAFE_INTEGER&&tx<=Number.MAX_SAFE_INTEGER)rates={rx,tx};}}
        this.previous={name,rx,tx,time};
        if(rates)this.history.push({time,at,...rates});else this.history=[];
        this.history=this.history.filter(point=>time-point.time<=60000).slice(-60);
        return{interface:name,rxBytesPerSec:rates?.rx??null,txBytesPerSec:rates?.tx??null,history:this.history.map(({at,rx,tx})=>({at,rx,tx}))};
    }
}
export async function listNetworkInterfaces(files:LinuxFiles,cancel:Cancellation):Promise<string[]>{return(await files.listNames('/sys/class/net',128,cancel)).filter(validName).sort();}
export class NetworkProvider implements ProviderDriver<'network'> {
    private sampler=new NetworkSampler();private selection='';
    constructor(private files:LinuxFiles,private monotonic:()=>number){}
    reset():void{this.sampler.reset();}
    async collect(context:ProviderContext):Promise<ProviderMap['network']>{
        const selected=context.config.networkInterface,cancel=context.cancel;
        if(this.selection!==selected){this.selection=selected;this.reset();}
        try{
            let name=selected;
            if(selected==='auto'){
                const read=(path:string)=>this.files.readText(path,256*1024,cancel).catch(()=>'');
                const [ipv4,ipv6]=await Promise.all([read('/proc/net/route'),read('/proc/net/ipv6_route')]);if(cancel.cancelled)throw new DataCancelled();
                const found=defaultInterface(ipv4,ipv6);if(!found)throw new DataFailure('NO_INTERFACE');name=found;
            }
            if(!validName(name))throw new DataFailure('INVALID_DATA');
            let counters:string[];
            try{counters=await Promise.all(['rx_bytes','tx_bytes'].map(file=>this.files.readText(`/sys/class/net/${name}/statistics/${file}`,128,cancel)));}
            catch{if(cancel.cancelled)throw new DataCancelled();throw new DataFailure('NO_INTERFACE');}
            if(cancel.cancelled)throw new DataCancelled();const data=this.sampler.sample(name,unsigned(counters[0]!.trim()),unsigned(counters[1]!.trim()),this.monotonic(),context.now);
            return{status:'ok',sourceId:providerSource('network',context.config),updatedAt:context.now,data,errorCode:null};
        }catch(error){this.reset();throw error;}
    }
}
