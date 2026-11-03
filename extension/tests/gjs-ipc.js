import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {SessionTransport} from '../dist/dbus.js';
import {DataClient} from '../dist/shared/dataClient.js';
import {ProviderStore} from '../dist/shared/providerStore.js';
if (GLib.getenv('LIQUID_PRIVATE_TEST')!=='1' || GLib.getenv('DBUS_SESSION_BUS_ADDRESS')===GLib.getenv('LIQUID_PARENT_BUS')) throw new Error('Private bus required');
function check(value,message){if(!value)throw new Error(message);}
const sleep=ms=>new Promise(resolve=>GLib.timeout_add(GLib.PRIORITY_DEFAULT,ms,()=>{resolve();return GLib.SOURCE_REMOVE;}));
async function until(predicate){for(let i=0;i<300;i++){if(predicate())return;await sleep(10);}throw new Error('GJS integration timed out');}
const transport=new SessionTransport();let owner=null;const unwatch=transport.watchOwner(value=>{owner=value;});
// Inject one transient read failure; keep the real bus, daemon and GLib retry timer.
const call=transport.call.bind(transport);let injected=false;
transport.call=(owner,method,args,cancel)=>{
    if(method==='GetSnapshot' && !injected){injected=true;return Promise.reject(new Error('temporary read failure'));}
    return call(owner,method,args,cancel);
};
const store=new ProviderStore();let connection='';let updates=0;
const client=new DataClient(transport,store,()=>{updates++;},state=>{connection=state;});
let process=null;
try {
    client.start(['system','network']);await until(()=>connection==='disconnected');
    process=Gio.Subprocess.new([GLib.getenv('LIQUID_DAEMON')],Gio.SubprocessFlags.NONE);
    await until(()=>connection==='connected' && owner!==null);
    const firstOwner=owner;const before=store.get('network').sourceId;
    await transport.call(owner,'SetNetworkInterface',['lo'],null);
    await until(()=>store.get('network').sourceId!==before);
    const [settings]=await transport.call(owner,'GetSettings',[],null);
    check(JSON.parse(settings).networkInterface==='lo','settings IPC failed');
    const retained=store.get('network').sourceId;
    process.force_exit();await until(()=>connection==='disconnected');
    check(store.get('network').sourceId===retained,'disconnect cleared last state');
    process=Gio.Subprocess.new([GLib.getenv('LIQUID_DAEMON')],Gio.SubprocessFlags.NONE);
    await until(()=>connection==='connected' && owner!==firstOwner);
    check(store.get('network').sourceId===retained,'restart changed persisted source');
    check(updates>=2,'no snapshot or signals received');
    client.stop();await sleep(100);
    check(!Gio.DBus.session.is_closed(),'client closed the shared session connection');
    const [raw]=await transport.call(owner,'GetSnapshot',[],null);
    check(JSON.parse(raw).schemaVersion===1,'shared bus unusable after disable');
    print('GJS IPC: live Rust service, same-owner retry, provider signal, settings, owner restart, retained state, shared bus cleanup passed');
} finally {client.stop();unwatch();process?.force_exit();}
