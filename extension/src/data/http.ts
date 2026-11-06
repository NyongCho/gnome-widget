import Soup from 'gi://Soup?version=3.0';
import Gio from 'gi://Gio';
import {Cancellation} from '../shared/dataClient.js';
import {bounded,gioAsync,checkIO} from './async.js';
import {DataFailure,DataCancelled} from './errors.js';
import {readBytes,closeStream} from '../calendar/streams.js';
import type {HttpClient} from './contracts.js';
export type {HttpClient} from './contracts.js';
export class SoupHttpClient implements HttpClient {
    private session=new Soup.Session({user_agent:'Liquid-Widgets/1'});
    private lifetime=new Cancellation();
    async get(url:string,limits:{maxBytes:number;timeoutMs:number},cancel:Cancellation):Promise<Uint8Array>{
        const combined=new Cancellation(),unlink=cancel.onCancel(()=>combined.cancel()),unlife=this.lifetime.onCancel(()=>combined.cancel());
        try{return await bounded(combined,limits.timeoutMs,'NETWORK_ERROR',async io=>{
            const message=Soup.Message.new('GET',url);if(!message)throw new DataFailure('INVALID_DATA');
            message.set_flags(message.get_flags()|Soup.MessageFlags.NO_REDIRECT);checkIO(io);
            const stream=await gioAsync(cb=>this.session.send_async(message,0,io,cb),r=>this.session.send_finish(r));
            try{
                const status=Number(message.get_status());
                if(status===429)throw new DataFailure('RATE_LIMITED');if(status===401||status===403)throw new DataFailure('AUTH_ERROR');
                if(status<200||status>=300)throw new DataFailure('NETWORK_ERROR');
                const chunks:Uint8Array[]=[];let size=0;
                for(;;){const chunk=await readBytes(stream,Math.min(65536,limits.maxBytes-size+1),io);if(!chunk.length)break;size+=chunk.length;if(size>limits.maxBytes)throw new DataFailure('PAYLOAD_TOO_LARGE');chunks.push(chunk);}
                const result=new Uint8Array(size);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}return result;
            }finally{await closeStream(stream);}
        });}catch(error){if(error instanceof DataFailure||error instanceof DataCancelled)throw error;throw new DataFailure('NETWORK_ERROR');}
        finally{unlink();unlife();}
    }
    destroy():void{this.lifetime.cancel();this.session.abort();}
}
