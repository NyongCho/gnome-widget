import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk?version=4.0';
import GLib from 'gi://GLib';
import {addCalendarSettings} from '../../src/prefs/calendar.js';
import {TextBindings} from '../../src/shared/i18n.js';
import type {PreferencesDataSession} from '../../src/backend/contracts.js';
import type {CalendarSummary,CalendarOrigin} from '../../src/shared/calendarSummary.js';
import type {Settings} from '../../src/types.js';
import {PublicPreferencesSession} from '../../src/prefs/dataSession.js';
import type {PublicDataServices} from '../../src/prefs/calendarPreview.js';
import type {SecretStore} from '../../src/data/contracts.js';
import {DataFailure} from '../../src/data/errors.js';
import {Cancellation} from '../../src/shared/dataClient.js';
const wait=()=>new Promise<void>(resolve=>GLib.timeout_add(0,10,()=>{resolve();return GLib.SOURCE_REMOVE;}));
function check(value:unknown,message:string):asserts value{if(!value)throw new Error(message);}
function descendants(widget:Gtk.Widget):Gtk.Widget[]{const children:Gtk.Widget[]=[widget];for(let child=widget.get_first_child();child;child=child.get_next_sibling())children.push(...descendants(child));return children;}
const connected:Settings={calendarEnabled:true,calendarSecretDeletionPending:false,weatherLocation:null,networkInterface:'auto'};
const summary:CalendarSummary={version:1,instanceId:'test',revision:1,sourceId:'source-a',generation:1,context:{month:'2026-11',timeZone:'UTC',weekStart:0},status:'ok',updatedAt:'2026-11-07T00:00:00Z',errorCode:null,hasData:true,eventCount:3};
function fixture(app:Adw.Application){
    const requests:{resolve:(settings:Settings)=>void;reject:(error:Error)=>void}[]=[];
    let notify!:(state:CalendarSummary,origin:CalendarOrigin)=>void;
    const session:PreferencesDataSession={
        getSettings:()=>new Promise((resolve,reject)=>requests.push({resolve,reject})),
        async setCalendarSecret(){},async clearCalendarSecret(){},async searchLocations(){return[];},
        async setWeatherLocation(){},async setNetworkInterface(){},async listNetworkInterfaces(){return[];},
        watchCalendar(changed){notify=changed;return()=>{};},async refreshCalendar(){},destroy(){},
    };
    const window=new Adw.PreferencesWindow({application:app}),page=new Adw.PreferencesPage(),ui=new TextBindings('en');
    addCalendarSettings(window,page,ui,session);window.add(page);window.present();
    const row=descendants(page).find(w=>w instanceof Adw.ActionRow&&w.title==='Widget synchronization') as Adw.ActionRow;
    check(row,'production calendar row missing');
    return{requests,row,notify:(state:CalendarSummary)=>notify(state,'shell'),close(){window.close();ui.destroy();}};
}
export async function verifyTwoWindowCleanup(app:Adw.Application,path:string,services:()=>PublicDataServices,secrets:SecretStore):Promise<void>{
    const windows:{window:Adw.PreferencesWindow;row:Adw.ActionRow;session:PublicPreferencesSession;ui:TextBindings}[]=[];
    const clear=secrets.clearAll;
    const until=async(test:()=>boolean,message:string)=>{for(let i=0;i<600;i++){if(test())return;await wait();}throw new Error(message);};
    try{
        for(let i=0;i<2;i++){
            const session=new PublicPreferencesSession(path,services()),window=new Adw.PreferencesWindow({application:app}),page=new Adw.PreferencesPage(),ui=new TextBindings('en');
            addCalendarSettings(window,page,ui,session);window.add(page);window.present();
            const row=descendants(page).find(w=>w instanceof Adw.ActionRow&&w.title==='Widget synchronization') as Adw.ActionRow;
            check(row,'real session calendar row missing');windows.push({window,row,session,ui});
        }
        const [left,right]=windows;
        await until(()=>(right!.row.subtitle??'').includes('Connection verified'),'second window did not verify existing connection');
        secrets.clearAll=async()=>{throw new DataFailure('KEYRING_LOCKED');};
        let failed=false;try{await left!.session.clearCalendarSecret(new Cancellation());}catch{failed=true;}
        check(failed,'fixture cleanup failure was not exercised');
        await until(()=>(right!.row.subtitle??'').includes('still need deletion'),'other window missed pending cleanup');
        secrets.clearAll=clear;
        await left!.session.clearCalendarSecret(new Cancellation());
        await until(()=>right!.row.subtitle==='Not connected','other window retained the warning after same-source cleanup');
        print(JSON.stringify({test:'two production GTK sessions propagate failed cleanup and same-null-source successful retry',success:true}));
    }finally{
        secrets.clearAll=clear;
        for(const item of windows){item.window.close();item.session.destroy();item.ui.destroy();}
    }
}
export async function verifyCalendarSettings(app:Adw.Application):Promise<void>{
    const failures:string[]=[];
    for(const late of ['snapshot','error']){
        const f=fixture(app);
        try{
            check(f.requests.length===1,'expected initial settings read');const old=f.requests.shift()!;
            f.notify(summary);check(f.requests.length===1,'source update must read settings');
            f.requests.shift()!.resolve(connected);await wait();check((f.row.subtitle??'').includes('Synced'),'new connection did not render');
            if(late==='snapshot')old.resolve({...connected,calendarEnabled:false});else old.reject(new Error('old read failed'));
            await wait();check((f.row.subtitle??'').includes('Synced'),`late ${late} overwrote the new connection: ${f.row.subtitle}`);
        }catch(error){failures.push(String(error));}finally{f.close();}
    }
    const f=fixture(app);
    try{
        const cleared:CalendarSummary={...summary,sourceId:null,status:'unconfigured',updatedAt:null,hasData:false,eventCount:0};
        f.notify(cleared);for(const request of f.requests.splice(0))request.resolve({...connected,calendarEnabled:false,calendarSecretDeletionPending:true});
        await wait();check((f.row.subtitle??'').includes('still need deletion'),'initial pending warning missing');
        f.notify({...cleared,revision:2});
        check(f.requests.length===1,'same-source settings notification must reload deletion state');
        f.requests.shift()!.resolve({...connected,calendarEnabled:false});await wait();
        check(f.row.subtitle==='Not connected','successful cleanup left a pending warning');
        f.notify({...cleared,revision:3});f.requests.shift()!.resolve({...connected,calendarEnabled:false,calendarSecretDeletionPending:true});await wait();
        check((f.row.subtitle??'').includes('still need deletion'),'same-source cleanup failure lost its warning');
    }catch(error){failures.push(String(error));}finally{f.close();}
    if(failures.length)throw new Error(failures.join('\n'));
    print(JSON.stringify({test:'real GTK settings ignore old snapshots/errors and update same-source deletion warnings',success:true}));
}
