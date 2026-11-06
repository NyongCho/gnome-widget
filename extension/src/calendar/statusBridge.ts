import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {Cancellation} from '../shared/dataClient.js';
import {summarizeCalendar,type CalendarSummary} from '../shared/calendarSummary.js';
import type {ProviderMap,CalendarContext} from '../types.js';
import {bounded,gioAsync} from '../data/async.js';
import {DataFailure} from '../data/errors.js';
import {CalendarTokens} from './statusRegistry.js';
import {STATUS_BUS,STATUS_PATH,STATUS_INTERFACE,STATUS_XML} from './statusContract.js';
export interface CalendarStatusSource {state:ProviderMap['calendar'];context:CalendarContext|null;generation:number}
interface StatusHost {calendarStatus():CalendarStatusSource;setCalendarWatchers(count:number):void;refresh(name:'calendar'):void}
/** Exported in the Shell process; this object never owns/closes the shared bus. */
export class CalendarStatusBridge {
    readonly instanceId=GLib.uuid_string_random();readonly ready:Promise<void>;
    private revision=0;private summary:CalendarSummary;private object:Gio.DBusExportedObject;private tokens:CalendarTokens;
    private signal=0;private name=0;private dead=false;private cancel=new Cancellation();
    constructor(private host:StatusHost,private bus=Gio.DBus.session){
        const initial=host.calendarStatus();this.summary=summarizeCalendar(this.instanceId,this.revision,initial.generation,initial.state,initial.context);
        this.tokens=new CalendarTokens(GLib.uuid_string_random,count=>host.setCalendarWatchers(count));
        this.signal=bus.signal_subscribe('org.freedesktop.DBus','org.freedesktop.DBus','NameOwnerChanged','/org/freedesktop/DBus',null,Gio.DBusSignalFlags.NONE,(_b,_s,_p,_i,_n,parameters)=>{
            const [sender,,next]=parameters.deep_unpack() as [string,string,string];if(sender.startsWith(':')&&!next)this.tokens.senderGone(sender);
        });
        this.object=Gio.DBusExportedObject.wrapJSObject(STATUS_XML,{
            WatchCalendarAsync:(_args:unknown[],invocation:Gio.DBusMethodInvocation)=>{void this.watch(invocation);},
            UnwatchCalendarAsync:([token]:[string],invocation:Gio.DBusMethodInvocation)=>{this.tokens.unwatch(invocation.get_sender()??'',token);invocation.return_value(null);},
            RefreshCalendarAsync:(_args:unknown[],invocation:Gio.DBusMethodInvocation)=>{if(!this.dead)this.host.refresh('calendar');invocation.return_value(null);},
        });
        this.object.export(bus,STATUS_PATH);
        this.ready=new Promise((resolve,reject)=>{this.name=Gio.bus_own_name_on_connection(bus,STATUS_BUS,Gio.BusNameOwnerFlags.DO_NOT_QUEUE,()=>resolve(),()=>reject(new DataFailure('SERVICE_UNAVAILABLE')));});
        // Consumers may just use the bridge's bus name; avoid unhandled rejection
        // if another installation already owns it. Tests can still await ready.
        void this.ready.catch(()=>{});
    }
    get watchCount():number{return this.tokens.size;}
    private async watch(invocation:Gio.DBusMethodInvocation):Promise<void>{
        let registration:ReturnType<CalendarTokens['begin']>|null=null;
        try{
            const sender=invocation.get_sender()??'';registration=this.tokens.begin(sender);
            const alive=await bounded(this.cancel,2000,'SERVICE_UNAVAILABLE',async io=>{
                const result=await gioAsync(cb=>this.bus.call('org.freedesktop.DBus','/org/freedesktop/DBus','org.freedesktop.DBus','NameHasOwner',new GLib.Variant('(s)',[sender]),new GLib.VariantType('(b)'),Gio.DBusCallFlags.NO_AUTO_START,2000,io,cb),r=>this.bus.call_finish(r));return(result.deep_unpack() as [boolean])[0];
            });
            if(!alive||this.dead)throw new DataFailure('SERVICE_UNAVAILABLE');const token=registration.commit();if(!token)throw new DataFailure('SERVICE_UNAVAILABLE');
            invocation.return_value(new GLib.Variant('(ss)',[token,JSON.stringify(this.summary)]));
        }catch(error){registration?.cancel();const code=error instanceof DataFailure?error.code:'SERVICE_UNAVAILABLE';invocation.return_dbus_error(`${STATUS_INTERFACE}.Error.${code}`,code);}
    }
    update():void{if(this.dead)return;const value=this.host.calendarStatus();this.summary=summarizeCalendar(this.instanceId,++this.revision,value.generation,value.state,value.context);this.object.emit_signal('CalendarStatusChanged',new GLib.Variant('(s)',[JSON.stringify(this.summary)]));}
    destroy():void{if(this.dead)return;this.dead=true;this.cancel.cancel();this.tokens.destroy();this.object.unexport();if(this.name){Gio.bus_unown_name(this.name);this.name=0;}if(this.signal){this.bus.signal_unsubscribe(this.signal);this.signal=0;}}
}
