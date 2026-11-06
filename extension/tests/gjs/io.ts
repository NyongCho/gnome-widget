import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import System from 'system';
import type Secret from 'gi://Secret?version=1';
import {Cancellation} from '../../src/shared/dataClient.js';
import {GioPrivateFiles} from '../../src/data/files.js';
import {SoupHttpClient} from '../../src/data/http.js';
import {SystemSecretStore} from '../../src/data/secrets.js';
import {ConfigStore} from '../../src/data/config.js';
import {DataSettingsService} from '../../src/data/settings.js';
import {acquireBusLease} from '../../src/data/busLease.js';
const root=ARGV[0]!,server=ARGV[1]!,loop=new GLib.MainLoop(null,false);let exitCode=0;
const cancel=()=>new Cancellation();
function assert(value:unknown,message:string):asserts value {if(!value)throw new Error(message);}
async function rejects(fn:Promise<unknown>,code?:string):Promise<void>{try{await fn;throw new Error('unexpected success');}catch(error){assert(error instanceof Error&&error.message!=='unexpected success','expected failure');if(code)assert(error.message===code,`expected ${code}, got ${error.message}`);}}
async function test(name:string,fn:()=>Promise<void>):Promise<void>{await fn();print(JSON.stringify({test:name,success:true}));}
void(async()=>{
    const files=new GioPrivateFiles(`${root}/private`);
    await test('private atomic files, size bound, regular-file-only and cancellation',async()=>{
        assert(await files.read('missing',100,cancel())===null,'missing only');
        await files.replace('sample',new TextEncoder().encode('old'),cancel());
        await files.replace('sample',new TextEncoder().encode('new'),cancel());
        assert(new TextDecoder().decode((await files.read('sample',3,cancel()))!)==='new','atomic replace');
        const mode=(path:string)=>Gio.File.new_for_path(path).query_info('unix::mode',Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,null).get_attribute_uint32('unix::mode')&0o777;
        assert(mode(`${root}/private`)===0o700&&mode(`${root}/private/sample`)===0o600,'private permissions');
        await rejects(files.read('sample',2,cancel()),'PAYLOAD_TOO_LARGE');
        await rejects(files.read('../sample',100,cancel()),'INVALID_DATA');
        for(const file of ['symlink','fifo']){await rejects(new GioPrivateFiles(`${root}/unsafe`).read(file,100,cancel()));await rejects(new GioPrivateFiles(`${root}/unsafe`).replace(file,new Uint8Array([1]),cancel()));}
        const stopped=cancel();stopped.cancel();await rejects(files.read('sample',100,stopped),'CANCELLED');
        await files.remove('sample',cancel());assert(await files.read('sample',100,cancel())===null,'remove');
    });
    await test('compressed_body_limit, redirect rejection and HTTP deadline',async()=>{
        const http=new SoupHttpClient();
        assert(new TextDecoder().decode(await http.get(`${server}/ok`,{maxBytes:2,timeoutMs:1000},cancel()))==='ok','body');
        await rejects(http.get(`${server}/compressed`,{maxBytes:1000,timeoutMs:1000},cancel()),'PAYLOAD_TOO_LARGE');
        await rejects(http.get(`${server}/redirect`,{maxBytes:1000,timeoutMs:1000},cancel()),'NETWORK_ERROR');
        await rejects(http.get(`${server}/slow`,{maxBytes:1000,timeoutMs:50},cancel()),'NETWORK_ERROR');http.destroy();
    });
    await test('missing Secret GI does not prevent other settings from loading',async()=>{
        const secrets=new SystemSecretStore(async()=>{throw new Error('missing');});
        const config=new ConfigStore({files,uuid:GLib.uuid_string_random,watch:cb=>files.watch(cb),acquire:c=>acquireBusLease('io.github.NyongCho.LiquidWidgets.ConfigLock',30000,c)});
        const settings=new DataSettingsService(config,secrets,files,GLib.uuid_string_random);
        await rejects(settings.setCalendarSecret('https://calendar.google.com/calendar/ical/test/private-test/basic.ics',cancel()),'SERVICE_UNAVAILABLE');
        await settings.setNetworkInterface('eth0',cancel());assert((await settings.getSettings(cancel())).networkInterface==='eth0','non-calendar settings');
    });
    await test('unresponsive keyring releases ConfigLock at the total eight second deadline',async()=>{
        const hanging=new SystemSecretStore(()=>new Promise(()=>{}));
        const config=new ConfigStore({files,uuid:GLib.uuid_string_random,watch:cb=>files.watch(cb),acquire:c=>acquireBusLease('io.github.NyongCho.LiquidWidgets.ConfigLock',30000,c)});
        const settings=new DataSettingsService(config,hanging,files,GLib.uuid_string_random),start=GLib.get_monotonic_time();
        const first=settings.setCalendarSecret('https://calendar.google.com/calendar/ical/test/private-test/basic.ics',cancel()).catch(e=>e);
        await new Promise<void>(resolve=>GLib.timeout_add(0,50,()=>{resolve();return GLib.SOURCE_REMOVE;}));
        const second=settings.setNetworkInterface('wlan0',cancel());await first;await second;
        const elapsed=(GLib.get_monotonic_time()-start)/1000;assert(elapsed>=7900&&elapsed<9000,`deadline ${elapsed}`);
    });
    await test('real isolated keyring saves, reads, removes and never prompts when locked',async()=>{
        const secret=new SystemSecretStore();const source=GLib.uuid_string_random(),url='https://calendar.google.com/calendar/ical/test/private-test/basic.ics';
        await secret.save(source,url,cancel());assert(await secret.lookup(source,cancel())===url,'lookup');
        await secret.remove(source,cancel());assert(await secret.lookup(source,cancel())===null,'remove');
        await secret.save(source,url,cancel());await secret.clearAll(cancel());assert(await secret.lookup(source,cancel())===null,'clear');
        await secret.save(source,url,cancel());
        const module=await import('gi://Secret?version=1');
        const service=await new Promise<Secret.Service>((resolve,reject)=>module.default.Service.get(module.default.ServiceFlags.LOAD_COLLECTIONS,null,(_s,r)=>{try{resolve(module.default.Service.get_finish(r));}catch(e){reject(e);}}));
        const collections=service.get_collections();assert(collections&&collections.length>0,'collection exists');
        await new Promise<void>((resolve,reject)=>service.lock(collections,null,(_s,r)=>{try{service.lock_finish(r);resolve();}catch(e){reject(e);}}));
        await rejects(secret.save(GLib.uuid_string_random(),url,cancel()),'KEYRING_LOCKED');
        await rejects(secret.lookup(source,cancel()),'KEYRING_LOCKED');
        await rejects(secret.remove(source,cancel()),'KEYRING_LOCKED');
    });
})().then(()=>loop.quit(),error=>{printerr(`${String(error)}\n${error instanceof Error?error.stack:''}`);exitCode=1;loop.quit();});
loop.run();System.exit(exitCode);
