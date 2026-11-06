import GLib from 'gi://GLib';
import {getEdition} from '../edition.js';
import type {WidgetSessionOptions} from '../backend/contracts.js';
import {acquireBusLease} from './busLease.js';
import {ConfigStore} from './config.js';
import {GioPrivateFiles} from './files.js';
import {SoupHttpClient} from './http.js';
import {SystemSecretStore} from './secrets.js';
import {DataSettingsService} from './settings.js';
import {LocalWidgetSession,type SessionClock} from './localSession.js';
export const gioClock:SessionClock={
    monotonic:()=>GLib.get_monotonic_time()/1000,
    now:()=>new Date().toISOString(),
    schedule(ms,fn){let id=GLib.timeout_add(GLib.PRIORITY_DEFAULT,ms,()=>{id=0;fn();return GLib.SOURCE_REMOVE;});return()=>{if(id){GLib.source_remove(id);id=0;}};},
};
/** Composition shared by public Shell sessions and preferences; no UI imports. */
export function createPublicDataServices(){
    const edition=getEdition('gjs');
    const configFiles=new GioPrivateFiles(GLib.build_filenamev([GLib.get_user_config_dir(),edition.dataDirectory]));
    const cache=new GioPrivateFiles(GLib.build_filenamev([GLib.get_user_cache_dir(),edition.dataDirectory]));
    const config=new ConfigStore({files:configFiles,uuid:GLib.uuid_string_random,watch:fn=>configFiles.watch(fn),
        acquire:cancel=>acquireBusLease('io.github.NyongCho.LiquidWidgets.ConfigLock',30000,cancel)});
    const http=new SoupHttpClient(),secrets=new SystemSecretStore(undefined,edition.secretApplication);
    const settings=new DataSettingsService(config,secrets,cache,GLib.uuid_string_random);
    return{config,cache,http,secrets,settings,clock:gioClock,destroy(){http.destroy();}};
}
export function createLocalWidgetSession(options:WidgetSessionOptions):LocalWidgetSession {
    const services=createPublicDataServices();
    // Provider adapters are added in Tasks 6–9; no external service is started here.
    return new LocalWidgetSession(options,{config:services.config,clock:services.clock,drivers:{},destroy:()=>services.destroy()});
}
