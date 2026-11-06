import type {Cancellation} from '../shared/dataClient.js';
import type {SecretStore} from './contracts.js';
export type {SecretStore} from './contracts.js';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import type Secret from 'gi://Secret?version=1';
import {EDITION} from '../edition.js';
import {bounded,gioAsync,checkIO} from './async.js';
import {DataFailure,DataCancelled} from './errors.js';
import {validateCalendarUrl} from './settings.js';
type SecretModule=typeof import('gi://Secret?version=1');
/** Secret is optional; importing this module never loads its GI typelib. */
export class SystemSecretStore implements SecretStore {
    constructor(private load:()=>Promise<SecretModule>=()=>import('gi://Secret?version=1'),private application=EDITION.secretApplication){}
    private async use<T>(cancel:Cancellation,fn:(module:SecretModule,service:Secret.Service,io:Gio.Cancellable)=>Promise<T>):Promise<T>{
        try{return await bounded(cancel,8000,'SERVICE_UNAVAILABLE',async io=>{
            const module=await this.load();checkIO(io);
            const service=await gioAsync(cb=>module.default.Service.get(module.default.ServiceFlags.OPEN_SESSION,io,cb),r=>module.default.Service.get_finish(r));checkIO(io);
            return fn(module,service,io);
        });}catch(error){if(error instanceof DataFailure||error instanceof DataCancelled)throw error;throw new DataFailure('SERVICE_UNAVAILABLE');}
    }
    private async search(module:SecretModule,service:Secret.Service,source:string|null,io:Gio.Cancellable):Promise<Secret.Item[]>{
        const attributes:Record<string,string>={application:this.application};if(source)attributes.source=source;checkIO(io);
        // Never set UNLOCK: a background collection cannot open an authentication UI.
        const items=await gioAsync(cb=>service.search(null,attributes,module.default.SearchFlags.ALL|module.default.SearchFlags.LOAD_SECRETS,io,cb),r=>service.search_finish(r));checkIO(io);
        if(items.some(item=>item.get_locked()))throw new DataFailure('KEYRING_LOCKED');return items;
    }
    private call(service:Secret.Service,path:string,iface:string,method:string,args:GLib.Variant|null,type:string,io:Gio.Cancellable):Promise<GLib.Variant>{
        checkIO(io);const connection=service.get_connection(),owner=service.get_name_owner();if(!owner)throw new DataFailure('SERVICE_UNAVAILABLE');
        return gioAsync(cb=>connection.call(owner,path,iface,method,args,new GLib.VariantType(type),Gio.DBusCallFlags.NO_AUTO_START,8000,io,cb),r=>connection.call_finish(r));
    }
    lookup(source:string,cancel:Cancellation):Promise<string|null>{return this.use(cancel,async(module,service,io)=>{
        const items=await this.search(module,service,source,io);if(!items.length)return null;
        const value=items[0]!.get_secret()?.get_text();if(!value)throw new DataFailure('KEYRING_LOCKED');validateCalendarUrl(value);return value;
    });}
    save(source:string,url:string,cancel:Cancellation):Promise<void>{
        validateCalendarUrl(url);
        return this.use(cancel,async(module,service,io)=>{
            const [path]=(await this.call(service,'/org/freedesktop/secrets','org.freedesktop.Secret.Service','ReadAlias',new GLib.Variant('(s)',['default']),'(o)',io)).deep_unpack() as [string];
            if(path==='/')throw new DataFailure('KEYRING_LOCKED');
            const [locked]=(await this.call(service,path,'org.freedesktop.DBus.Properties','Get',new GLib.Variant('(ss)',['org.freedesktop.Secret.Collection','Locked']),'(v)',io)).deep_unpack() as [GLib.Variant];
            if(locked.deep_unpack())throw new DataFailure('KEYRING_LOCKED');checkIO(io);
            const value=new module.default.Value(url,-1,'text/plain; charset=utf8');
            const secret=service.encode_dbus_secret(value).deep_unpack() as [string,Uint8Array,Uint8Array,string];
            const properties={'org.freedesktop.Secret.Item.Label':new GLib.Variant('s','Liquid Widgets · Google Calendar'),'org.freedesktop.Secret.Item.Attributes':new GLib.Variant('a{ss}',{application:this.application,source})};
            const [,prompt]=(await this.call(service,path,'org.freedesktop.Secret.Collection','CreateItem',new GLib.Variant('(a{sv}(oayays)b)',[properties,secret,true]),'(oo)',io)).deep_unpack() as [string,string];
            // Unlike Secret.Item.create, this raw call never runs a returned Prompt.
            if(prompt!=='/')throw new DataFailure('KEYRING_LOCKED');
        });
    }
    private erase(source:string|null,cancel:Cancellation):Promise<void>{return this.use(cancel,async(module,service,io)=>{
        const items=await this.search(module,service,source,io);
        // Snapshot paths only: a delayed deletion cannot match a future source UUID.
        for(const item of items){checkIO(io);const [prompt]=(await this.call(service,item.get_object_path(),'org.freedesktop.Secret.Item','Delete',null,'(o)',io)).deep_unpack() as [string];
            if(prompt!=='/')throw new DataFailure('KEYRING_LOCKED');}
    });}
    remove(source:string,cancel:Cancellation):Promise<void>{return this.erase(source,cancel);}
    clearAll(cancel:Cancellation):Promise<void>{return this.erase(null,cancel);}
}
