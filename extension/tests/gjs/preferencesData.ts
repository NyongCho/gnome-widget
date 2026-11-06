import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk?version=4.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';
import {PublicPreferencesSession} from '../../src/prefs/dataSession.js';
import {CalendarStatusBridge} from '../../src/calendar/statusBridge.js';
import {CalendarStatusClient} from '../../src/calendar/statusClient.js';
import {GioStatusTransport} from '../../src/calendar/statusTransport.js';
import {STATUS_BUS} from '../../src/calendar/statusContract.js';
import {createPublicDataServices,gioClock} from '../../src/data/runtime.js';
import {DataSettingsService} from '../../src/data/settings.js';
import {LocalWidgetSession} from '../../src/data/localSession.js';
import {ProviderStore} from '../../src/shared/providerStore.js';
import {Cancellation} from '../../src/shared/dataClient.js';
import {gioAsync} from '../../src/data/async.js';
import type {CalendarSummary,CalendarOrigin} from '../../src/shared/calendarSummary.js';
import type {SecretStore} from '../../src/data/contracts.js';
import {verifyCalendarSettings,verifyTwoWindowCleanup} from './calendarSettings.js';
const [directory,endpoint]=ARGV as [string,string],loop=new GLib.MainLoop(null,false);let exitCode=0;
const URL='https://calendar.google.com/calendar/ical/synthetic/private-fixture/basic.ics',cancel=()=>new Cancellation();
const wait=(ms:number)=>new Promise<void>(resolve=>GLib.timeout_add(0,ms,()=>{resolve();return GLib.SOURCE_REMOVE;}));
function assert(value:unknown,message:string):asserts value{if(!value)throw new Error(message);}
async function until(predicate:()=>boolean|Promise<boolean>,label:string,ms=6000){const end=GLib.get_monotonic_time()+ms*1000;while(!await predicate()){assert(GLib.get_monotonic_time()<end,label);await wait(10);}}
const values=new Map<string,string>(),secrets:SecretStore={async lookup(s){return values.get(s)??null;},async save(s,u){values.set(s,u);},async remove(s){values.delete(s);},async clearAll(){values.clear();}};
function services(){const base=createPublicDataServices(),original=base.http.get.bind(base.http);let requests=0,canceled=0;base.http.get=async(url,limits,c)=>{if(url.startsWith('https://calendar.google.com/')){requests++;const unlink=c.onCancel(()=>canceled++);try{return await original(`${endpoint}/feed`,limits,c);}finally{unlink();}}return original(url,limits,c);};return{...base,secrets,settings:new DataSettingsService(base.config,secrets,base.cache,GLib.uuid_string_random),get requests(){return requests;},get canceled(){return canceled;},async mode(mode:string){await original(`${endpoint}/mode/${mode}`,{maxBytes:100,timeoutMs:1000},cancel());}};}
async function owned(name:string):Promise<boolean>{const bus=Gio.DBus.session,result=await gioAsync(cb=>bus.call('org.freedesktop.DBus','/org/freedesktop/DBus','org.freedesktop.DBus','NameHasOwner',new GLib.Variant('(s)',[name]),new GLib.VariantType('(b)'),0,1000,null,cb),r=>bus.call_finish(r));return(result.deep_unpack() as [boolean])[0];}
void(async()=>{
    const data=services();await data.mode('normal');const prefs=new PublicPreferencesSession(directory,data);await prefs.setCalendarSecret(URL,cancel());let last:{state:CalendarSummary;origin:CalendarOrigin}|null=null;
    const unwatch=prefs.watchCalendar((state,origin)=>{last={state,origin};});await until(()=>last?.origin==='preview'&&last.state.status==='ok','prefs while extension off');assert(last!.state.context?.weekStart===0,'preview context is local weekStart 0');
    await data.mode('slow');const requests=data.requests;await prefs.refreshCalendar(cancel());await until(()=>data.requests>requests,'preview request started');
    const shellServices=createPublicDataServices(),store=new ProviderStore();let bridge:CalendarStatusBridge|null=null,collections=0;
    const shell=new LocalWidgetSession({extensionPath:directory,store,changed(name){if(name==='calendar')bridge?.update();},connection(){}},{config:shellServices.config,clock:gioClock,drivers:{calendar:{async collect(c){collections++;return{status:'ok',sourceId:c.config.calendar.sourceId,updatedAt:c.now,errorCode:null,data:{...c.calendarContext,events:[]}};}}},destroy:()=>shellServices.destroy()});await shell.ready;shell.setCalendarContext({month:'2026-12',timeZone:'Asia/Seoul',weekStart:1},'2026-11-07');
    bridge=new CalendarStatusBridge(shell);await bridge.ready;await until(()=>last?.origin==='shell'&&last.state.status==='ok','shell replaces preview');assert(data.canceled>0,'Shell appearance cancels preview HTTP');assert(collections===1&&bridge.watchCount===1,'hidden calendar collects only for preferences');assert(last!.state.context?.month==='2026-12'&&Number(last!.state.context?.weekStart)===1,'actual Shell context replaces preview context');
    const foreign=await gioAsync(cb=>Gio.DBusConnection.new_for_address(Gio.dbus_address_get_for_bus_sync(Gio.BusType.SESSION,null),Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT|Gio.DBusConnectionFlags.MESSAGE_BUS_CONNECTION,null,null,cb),r=>Gio.DBusConnection.new_for_address_finish(r));foreign.set_exit_on_close(false);
    const foreignWire=new GioStatusTransport(foreign),owner=Gio.DBus.session.get_unique_name()!,reply=await foreignWire.call(owner,'WatchCalendar',[],null);assert(Number(bridge.watchCount)===2,'foreign sender has its own token');await new GioStatusTransport().call(owner,'UnwatchCalendar',[reply[0]],null);assert(Number(bridge.watchCount)===2,'foreign token cannot be removed by another sender');await gioAsync(cb=>foreign.close(null,cb),r=>foreign.close_finish(r));await until(()=>bridge!.watchCount===1,'sender death releases token and demand');
    const native=new GioStatusTransport(),pending:{reply:readonly unknown[];resolve:(reply:readonly unknown[])=>void}[]=[];const delayed={watchOwner:native.watchOwner.bind(native),watchChanges:native.watchChanges.bind(native),async call(owner:string,method:string,args:readonly unknown[],c:Cancellation|null){const reply=await native.call(owner,method,args,c);if(method==='WatchCalendar')return new Promise<readonly unknown[]>(resolve=>pending.push({reply,resolve}));return reply;}};
    let lateUi=0;const late=new CalendarStatusClient(delayed,()=>lateUi++,()=>{});late.start();await until(()=>pending.length===1&&bridge!.watchCount===2,'late watch allocated on actual bus');late.destroy();const held=pending.shift()!;held.resolve(held.reply);await until(()=>bridge!.watchCount===1,'late token cleaned on original live owner');assert(lateUi===0&&!Gio.DBus.session.is_closed(),'close preserves shared bus and does not update UI');
    // Same unique bus owner, new bridge instance: an old late UUID must not
    // remove the new instance's subscription or replace its status.
    const states:CalendarSummary[]=[],reattach=new CalendarStatusClient(delayed,s=>states.push(s),()=>{});reattach.start();await until(()=>pending.length===1,'old attachment queued');const old=pending.shift()!;const oldInstance=bridge.instanceId;bridge.destroy();bridge=new CalendarStatusBridge(shell);await bridge.ready;await until(()=>pending.length===1,'new attachment queued');const current=pending.shift()!;current.resolve(current.reply);await until(()=>states.length===1,'new instance applied');old.resolve(old.reply);await wait(50);assert(states[0]?.instanceId===bridge.instanceId&&bridge.instanceId!==oldInstance&&Number(bridge.watchCount)===2,'reenable same owner retains both current watchers');reattach.destroy();await until(()=>bridge!.watchCount===1,'new client unsubscribed');
    await data.mode('normal');bridge.destroy();shell.destroy();await shell.drained;await until(()=>last?.origin==='preview'&&last.state.status==='ok','Shell disappearance starts new preview');
    const secondData=services(),second=new PublicPreferencesSession(directory,secondData);await Promise.all([prefs.setCalendarSecret(URL.replace('fixture','second'),cancel()),second.clearCalendarSecret(cancel())]);await second.clearCalendarSecret(cancel());assert(!(await prefs.getSettings(cancel())).calendarEnabled&&values.size===0,'two windows serialize connect and clear');await until(()=>last?.state.status==='unconfigured','clear reflected in preview');second.destroy();
    unwatch();prefs.destroy();
    const heavyData=services();await heavyData.mode('sparse');const heavy=new PublicPreferencesSession(directory,heavyData);await heavy.setCalendarSecret(URL,cancel());heavy.watchCalendar(()=>{});await until(()=>owned('io.github.NyongCho.LiquidWidgets.CalendarJob'),'preview worker running');const start=GLib.get_monotonic_time();heavy.destroy();await until(async()=>!await owned('io.github.NyongCho.LiquidWidgets.CalendarJob'),'closing settings reaps worker');assert((GLib.get_monotonic_time()-start)/1000000<1,'close during job within 1s');
    // Use a real private GTK window for the window-close lifecycle. The full
    // production preference form and keyboard navigation are checked in Task 11.
    Adw.init();const app=new Adw.Application({application_id:'io.github.NyongCho.LiquidWidgets.PreferenceTest',flags:Gio.ApplicationFlags.NON_UNIQUE});app.register(null);const windowData=services();await windowData.mode('normal');const windowSession=new PublicPreferencesSession(directory,windowData);let displayed='';
    await verifyCalendarSettings(app);
    await verifyTwoWindowCleanup(app,directory,services,secrets);
    await windowSession.setCalendarSecret(URL,cancel());
    const window=new Adw.PreferencesWindow({application:app,title:'Liquid Widgets verification',default_width:400,default_height:200}),page=new Adw.PreferencesPage(),group=new Adw.PreferencesGroup(),row=new Adw.ActionRow({title:'Calendar status'});group.add(row);page.add(group);window.add(page);
    windowSession.watchCalendar((state,origin)=>{displayed=`${origin}: ${state.status}`;row.subtitle=displayed;});window.connect('close-request',()=>{windowSession.destroy();return false;});window.present();await until(()=>displayed==='preview: ok','GTK displays preview status');window.close();await wait(50);assert(!window.visible,'GTK closes');const reopened=new Adw.PreferencesWindow({application:app,title:'Liquid Widgets verification reopened'});reopened.present();await wait(30);reopened.close();
    // Two settings windows contend for the same real calendar compute lease.
    const leftData=services();await leftData.mode('sparse');
    const left=new PublicPreferencesSession(directory,leftData);left.watchCalendar(()=>{});
    await until(()=>owned('io.github.NyongCho.LiquidWidgets.CalendarJob'),'first settings window owns the slot');
    const rightData=services();await rightData.mode('normal');const right=new PublicPreferencesSession(directory,rightData);let rightReady=false;
    right.watchCalendar(state=>{rightReady=state.status==='ok';});await until(()=>rightData.requests>0,'second settings window requested data');await wait(100);
    assert(!rightReady,'second window computed before the existing slot was released');
    left.destroy();await until(()=>rightReady,'second settings window takes the released slot');right.destroy();
    await until(async()=>!await owned('io.github.NyongCho.LiquidWidgets.CalendarJob'),'both windows leave no worker');
    const fdCount=()=>{const e=Gio.File.new_for_path('/proc/self/fd').enumerate_children('standard::name',0,null);let n=0;while(e.next_file(null))n++;e.close(null);return n;};
    async function windowCycle(){
        const d=services(),session=new PublicPreferencesSession(directory,d);let ready=false,late=0,closed=false;
        const w=new Adw.PreferencesWindow({application:app,title:'Liquid Widgets lifecycle'});
        session.watchCalendar(state=>{if(closed)late++;if(state.status==='ok')ready=true;});
        w.connect('close-request',()=>{closed=true;session.destroy();return false;});w.present();
        await until(()=>ready,'settings cycle preview completes');w.close();
        await until(async()=>!await owned('io.github.NyongCho.LiquidWidgets.CalendarJob'),'settings cycle worker exits');
        await wait(30);assert(!w.visible&&late===0,'closed window received an update');
    }
    // Warm GTK/GIO connection setup before measuring descriptors.
    await windowCycle();await windowCycle();System.gc();await wait(100);const beforeFds=fdCount();
    for(let i=0;i<20;i++)await windowCycle();System.gc();await wait(200);
    const afterFds=fdCount();assert(afterFds<=beforeFds,`settings FD growth: ${beforeFds} -> ${afterFds}`);
    assert(!await owned(STATUS_BUS)&&!await owned('io.github.NyongCho.LiquidWidgets.CalendarJob'),'settings loop retained a bridge/worker name');
    print(JSON.stringify({test:'20 actual GTK preview open/close cycles and two-window compute contention',success:true,beforeFds,afterFds}));
    print(JSON.stringify({test:'prefs off/on, hidden demand, preview cancellation, late token, same owner new instance, two-window mutations, close during worker and real GTK display/close',success:true}));
})().then(()=>loop.quit(),error=>{printerr(`${String(error)}\n${error instanceof Error?error.stack:''}`);exitCode=1;loop.quit();});loop.run();System.exit(exitCode);
