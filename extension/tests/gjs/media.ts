import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';
import {GioMprisBus} from '../../src/data/mpris.js';
import {GioArtworkStore} from '../../src/data/artworkFiles.js';
import {MediaProvider} from '../../src/data/providers/media.js';
import {ArtworkLoader} from '../../src/data/providers/mediaArt.js';
import {SoupHttpClient} from '../../src/data/http.js';
import {gioAsync} from '../../src/data/async.js';
import {gioClock} from '../../src/data/runtime.js';
import {Cancellation} from '../../src/shared/dataClient.js';
import {loadArtworkPixbuf} from '../../src/widgets/artworkDecode.js';
import type {ProviderMap} from '../../src/types.js';
const [root,endpoint]=ARGV as [string,string],loop=new GLib.MainLoop(null,false);let exitCode=0;
const wait=(ms:number)=>new Promise<void>(resolve=>GLib.timeout_add(0,ms,()=>{resolve();return GLib.SOURCE_REMOVE;}));
function assert(value:unknown,message:string):asserts value{if(!value)throw new Error(message);}
async function until(predicate:()=>boolean,label:string,ms=4000){const deadline=GLib.get_monotonic_time()+ms*1000;while(!predicate()){assert(GLib.get_monotonic_time()<deadline,label);await wait(10);}}
const PATH='/org/mpris/MediaPlayer2',PROPS='org.freedesktop.DBus.Properties',PLAYER='org.mpris.MediaPlayer2.Player',NAME='org.mpris.MediaPlayer2.fixture';
const XML=`<node><interface name="${PROPS}"><method name="GetAll"><arg direction="in" type="s"/><arg direction="out" type="a{sv}"/></method></interface></node>`;
async function open():Promise<Gio.DBusConnection>{const connection=await gioAsync(cb=>Gio.DBusConnection.new_for_address(Gio.dbus_address_get_for_bus_sync(Gio.BusType.SESSION,null),Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT|Gio.DBusConnectionFlags.MESSAGE_BUS_CONNECTION,null,null,cb),r=>Gio.DBusConnection.new_for_address_finish(r));connection.set_exit_on_close(false);return connection;}
async function call(bus:Gio.DBusConnection,method:string,args:GLib.Variant){return gioAsync(cb=>bus.call('org.freedesktop.DBus','/org/freedesktop/DBus','org.freedesktop.DBus',method,args,null,0,2000,null,cb),r=>bus.call_finish(r));}
function fake(bus:Gio.DBusConnection){
    let title='Wide',status='Playing',art='https://fixture.invalid/wide',hang=false;const pending:Gio.DBusMethodInvocation[]=[];
    const reply=(iface:string)=>new GLib.Variant('(a{sv})',[iface===PLAYER?{PlaybackStatus:new GLib.Variant('s',status),Metadata:new GLib.Variant('a{sv}',{'xesam:title':new GLib.Variant('s',title),'xesam:artist':new GLib.Variant('as',['Test Artist']),'mpris:artUrl':new GLib.Variant('s',art),'mpris:trackid':new GLib.Variant('o',`/track/${title}`)})}:{Identity:new GLib.Variant('s','Fixture')}]);
    const object=Gio.DBusExportedObject.wrapJSObject(XML,{GetAllAsync([iface]:[string],invocation:Gio.DBusMethodInvocation){if(hang)pending.push(invocation);else invocation.return_value(reply(iface));}});object.export(bus,PATH);
    return{change(nextTitle:string,nextStatus='Playing',nextArt='https://fixture.invalid/square',signal=true){title=nextTitle;status=nextStatus;art=nextArt;if(signal)bus.emit_signal(null,PATH,PROPS,'PropertiesChanged',new GLib.Variant('(sa{sv}as)',[PLAYER,{},['Metadata','PlaybackStatus']]));},setHang(value:boolean){hang=value;},destroy(){for(const invocation of pending)invocation.return_dbus_error('org.test.Closed','closed');object.unexport();}};
}
void(async()=>{
    const cancel=new Cancellation(),cache=new GioArtworkStore(`${root}/cache`),http=new SoupHttpClient();let requests=0;
    const loader=new ArtworkLoader({get(uri,limits,c){requests++;return http.get(`${endpoint}/${uri.split('/').at(-1)}`,limits,c);}},cache,gioClock);
    for(const uri of [`file://${root}/fifo`,`file://${root}/link`,`file://${root}/oversize`,'file://host/path'])assert(await loader.loadArtwork(uri,cancel)===null,'reject abnormal local file');
    for(const ending of ['link','fifo'])assert(await cache.cached(`https://fixture.invalid/${ending}`,cancel)===null,'abnormal cache rejected');
    const wide=await loader.loadArtwork('https://fixture.invalid/wide',cancel);assert(wide&&wide.startsWith('file:///'),'remote maps to private local file');
    assert(await loader.loadArtwork(wide,cancel)===wide,'readable local art without HTTP');
    const firstRequests=requests;assert(await loader.loadArtwork('https://fixture.invalid/wide',cancel)===wide&&requests===firstRequests,'cache hit without HTTP');
    const widePixbuf=await loadArtworkPixbuf(wide,78,44,new Gio.Cancellable());assert(widePixbuf.get_width()===78&&widePixbuf.get_height()===44,'16:9 preserved by renderer decode path');
    const square=await loader.loadArtwork('https://fixture.invalid/square',cancel);assert(square,'square URI');const squarePixbuf=await loadArtworkPixbuf(square,78,44,new Gio.Cancellable());assert(squarePixbuf.get_width()===44&&squarePixbuf.get_height()===44,'square preserved');
    const broken=await loader.loadArtwork('https://fixture.invalid/broken',cancel);assert(broken,'broken art may be cached');let failed=false;try{await loadArtworkPixbuf(broken,78,44,new Gio.Cancellable());}catch{failed=true;}assert(failed,'broken decode keeps icon');
    assert(await loader.loadArtwork('https://fixture.invalid/empty',cancel)===null,'empty art ignored');assert(await loader.loadArtwork('https://fixture.invalid/large',cancel)===null,'stream bound 8 MiB');
    const publicUri='https://fixture.invalid/public',publicName=GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256,publicUri,-1)+'.art';GLib.file_set_contents(`${root}/cache/${publicName}`,'public');Gio.File.new_for_path(`${root}/cache/${publicName}`).set_attribute_uint32('unix::mode',0o644,0,null);assert(await cache.cached(publicUri,cancel)===null,'cache rejects nonprivate mode');
    const cap=new GioArtworkStore(`${root}/cap`);assert(await cap.put('https://fixture.invalid/cap',new Uint8Array(8*1024*1024),cancel),'prune and put');
    const enumerator=Gio.File.new_for_path(`${root}/cap`).enumerate_children('standard::name,standard::size',0,null);let info,count=0,size=0;while((info=enumerator.next_file(null))){assert(!info.get_name().startsWith('.tmp-'),'crash temp removed');count++;size+=info.get_size();}enumerator.close(null);assert(count<=64&&size<=64*1024*1024,`cache caps ${count}/${size}`);
    const countCache=new GioArtworkStore(`${root}/count`);await countCache.put('https://fixture.invalid/count',new Uint8Array([1]),cancel);const listed=Gio.File.new_for_path(`${root}/count`).enumerate_children('standard::name',0,null);let fileCount=0;while(listed.next_file(null))fileCount++;listed.close(null);assert(fileCount===64,'64 file cap');
    const server=await open(),replacement=await open(),a=fake(server),b=fake(replacement);await call(server,'RequestName',new GLib.Variant('(su)',[NAME,0]));
    const bus=new GioMprisBus(Gio.DBus.session);let watches=0;const original=bus.watch.bind(bus);bus.watch=fn=>{watches++;const stop=original(fn);return()=>{watches--;stop();};};
    const lifetime=new Cancellation(),states:ProviderMap['media'][]=[];let readCancels=0;
    const provider=new MediaProvider(bus,{async loadArtwork(uri,c){if(uri.includes('/slow')){const unlink=c.onCancel(()=>readCancels++);try{return await loader.loadArtwork(uri,c);}finally{unlink();}}return loader.loadArtwork(uri,c);}},gioClock);provider.start(s=>states.push(s),lifetime);
    await until(()=>states.at(-1)?.data?.artUri===wide,'initial wide metadata/art');a.change('Square');await until(()=>states.at(-1)?.data?.title==='Square'&&states.at(-1)?.data?.artUri===square,'property signal without polling');
    a.change('Slow','Playing','https://fixture.invalid/slow');await until(()=>states.at(-1)?.data?.title==='Slow','metadata before art');await wait(20);a.change('B');await until(()=>states.at(-1)?.data?.title==='B'&&states.at(-1)?.data?.artUri===square,'track B wins slow art');assert(readCancels===1,'old art canceled');
    a.change('B','Paused');await until(()=>states.at(-1)?.errorCode==='NO_PLAYER','pause clears player');
    await call(server,'ReleaseName',new GLib.Variant('(s)',[NAME]));await call(replacement,'RequestName',new GLib.Variant('(su)',[NAME,0]));b.change('Replacement');await until(()=>states.at(-1)?.data?.title==='Replacement','owner replacement');
    b.change('Delayed','Playing','https://fixture.invalid/slow');await until(()=>states.at(-1)?.data?.title==='Delayed','metadata before delayed download');await wait(30);b.change('Quiet','Playing','',false);await until(()=>states.at(-1)?.data?.title==='Quiet','completed art revalidates metadata before signal');assert(states.at(-1)?.data?.artUri===null,'quiet track never inherits delayed artwork');
    b.setHang(true);const start=GLib.get_monotonic_time();let timeout=false;try{await bus.read(replacement.get_unique_name()!,cancel);}catch{timeout=true;}const elapsed=(GLib.get_monotonic_time()-start)/1000000;assert(timeout&&elapsed>=1.8&&elapsed<2.6,`2s D-Bus timeout ${elapsed}`);b.setHang(false);
    b.change('Disable','Playing','https://fixture.invalid/slow-disable');await until(()=>states.at(-1)?.data?.title==='Disable','pending disable metadata');await wait(20);lifetime.cancel();const before=states.length;await wait(200);assert(watches===0&&Number(readCancels)===2&&states.length===before,'disable unsubscribes and cancels art');
    provider.destroy();a.destroy();b.destroy();await gioAsync(cb=>server.close(null,cb),r=>server.close_finish(r));await gioAsync(cb=>replacement.close(null,cb),r=>replacement.close_finish(r));http.destroy();
    print(JSON.stringify({test:'real MPRIS owner/property/pause/timeout/disable; art cache bounds and native 16:9/square decode',success:true}));
})().then(()=>loop.quit(),error=>{printerr(`${String(error)}\n${error instanceof Error?error.stack:''}`);exitCode=1;loop.quit();});loop.run();System.exit(exitCode);
