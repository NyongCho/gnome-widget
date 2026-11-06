import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import type {Cancellation} from '../shared/dataClient.js';
import {bounded,gioAsync} from './async.js';
import type {MprisBus,MprisEvent,PlayerSnapshot} from './providers/media.js';
const BUS='org.freedesktop.DBus',BUS_PATH='/org/freedesktop/DBus',PATH='/org/mpris/MediaPlayer2',PROPS='org.freedesktop.DBus.Properties',PLAYER='org.mpris.MediaPlayer2.Player';
const text=(value:unknown,max=4096)=>typeof value==='string'?value.slice(0,max):'';
const unpack=(value:unknown):unknown=>value instanceof GLib.Variant?value.deep_unpack():value;
const record=(value:unknown):Record<string,unknown>=>{const unpacked=unpack(value);return unpacked&&typeof unpacked==='object'&&!Array.isArray(unpacked)?unpacked as Record<string,unknown>:{};};
export class GioMprisBus implements MprisBus {
    constructor(private connection:Gio.DBusConnection){}
    private call(destination:string,path:string,iface:string,method:string,args:GLib.Variant|null,type:string,io:Gio.Cancellable):Promise<GLib.Variant>{
        return gioAsync(cb=>this.connection.call(destination,path,iface,method,args,new GLib.VariantType(type),Gio.DBusCallFlags.NO_AUTO_START,2000,io,cb),r=>this.connection.call_finish(r));
    }
    listNames(cancel:Cancellation):Promise<string[]>{return bounded(cancel,2000,'SERVICE_UNAVAILABLE',async io=>((await this.call(BUS,BUS_PATH,BUS,'ListNames',null,'(as)',io)).deep_unpack() as [string[]])[0]);}
    getOwner(name:string,cancel:Cancellation):Promise<string>{return bounded(cancel,2000,'SERVICE_UNAVAILABLE',async io=>((await this.call(BUS,BUS_PATH,BUS,'GetNameOwner',new GLib.Variant('(s)',[name]),'(s)',io)).deep_unpack() as [string])[0]);}
    read(owner:string,cancel:Cancellation):Promise<PlayerSnapshot>{return bounded(cancel,2000,'SERVICE_UNAVAILABLE',async io=>{
        const [player,root]=await Promise.all([
            this.call(owner,PATH,PROPS,'GetAll',new GLib.Variant('(s)',[PLAYER]),'(a{sv})',io),
            this.call(owner,PATH,PROPS,'GetAll',new GLib.Variant('(s)',['org.mpris.MediaPlayer2']),'(a{sv})',io).catch(()=>null),
        ]);
        const values=record((player.deep_unpack() as [unknown])[0]),metadata=record(values.Metadata),identity=root?record((root.deep_unpack() as [unknown])[0]):{};
        const artists=unpack(metadata['xesam:artist']),rawUri=unpack(metadata['mpris:artUrl']),uri=typeof rawUri==='string'&&rawUri.length<=4096?rawUri:'';
        return{identity:text(unpack(identity.Identity),255),status:text(unpack(values.PlaybackStatus),16),title:text(unpack(metadata['xesam:title'])),artist:Array.isArray(artists)?artists.slice(0,64).filter(v=>typeof v==='string').map(v=>text(v)).join(', ').slice(0,4096):'',artUri:uri||null,trackId:text(unpack(metadata['mpris:trackid']))};
    });}
    watch(changed:(event:MprisEvent)=>void):()=>void {
        const ids:number[]=[];
        ids.push(this.connection.signal_subscribe(BUS,BUS,'NameOwnerChanged',BUS_PATH,'org.mpris.MediaPlayer2',Gio.DBusSignalFlags.MATCH_ARG0_NAMESPACE,(_c,_sender,_path,_iface,_signal,parameters)=>{
            const [name,oldOwner,newOwner]=parameters.deep_unpack() as [string,string,string];changed({kind:'owner',name,oldOwner,newOwner});
        }));
        ids.push(this.connection.signal_subscribe(null,PROPS,'PropertiesChanged',PATH,PLAYER,Gio.DBusSignalFlags.NONE,(_c,sender,_path,_iface,_signal,parameters)=>{
            const [,values,invalidated]=parameters.deep_unpack() as [string,Record<string,unknown>,string[]];
            if('Metadata'in values||'PlaybackStatus'in values||invalidated.includes('Metadata')||invalidated.includes('PlaybackStatus'))changed({kind:'properties',owner:sender??''});
        }));
        let alive=true;return()=>{if(alive){alive=false;for(const id of ids)this.connection.signal_unsubscribe(id);}};
    }
}
