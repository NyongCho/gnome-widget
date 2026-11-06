import GLib from 'gi://GLib';
import {getEdition} from '../edition.js';
import type {WidgetSessionOptions} from '../backend/contracts.js';
import {acquireBusLease} from './busLease.js';
import {ConfigStore} from './config.js';
import {GioPrivateFiles} from './files.js';
import {SoupHttpClient} from './http.js';
import {SystemSecretStore} from './secrets.js';
import {DataSettingsService} from './settings.js';
import {GioLinuxFiles} from './linux.js';
import {SystemProvider} from './providers/system.js';
import {NetworkProvider,listNetworkInterfaces} from './providers/network.js';
import {WeatherProvider,LocationSearch} from './providers/weather.js';
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
    const weather=new WeatherProvider(http,cache,config),locations=new LocationSearch(http,gioClock.monotonic);
    const linux=new GioLinuxFiles(),system=new SystemProvider(linux,gioClock),network=new NetworkProvider(linux,gioClock.monotonic);
    return{config,cache,http,secrets,settings,weather,locations,system,network,listNetworkInterfaces:(cancel:import('../shared/dataClient.js').Cancellation)=>listNetworkInterfaces(linux,cancel),clock:gioClock,destroy(){http.destroy();}};
}
export function createLocalWidgetSession(options:WidgetSessionOptions):LocalWidgetSession {
    const services=createPublicDataServices();
    // Remaining provider adapters are added in Tasks 8–9.
    return new LocalWidgetSession(options,{config:services.config,clock:services.clock,drivers:{weather:services.weather,system:services.system,network:services.network},destroy:()=>services.destroy()});
}
