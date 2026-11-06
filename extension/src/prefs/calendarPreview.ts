import GLib from 'gi://GLib';
import {CalendarWorkerClient} from '../calendar/workerClient.js';
import {CalendarProvider} from '../data/providers/calendar.js';
import {LocalWidgetSession} from '../data/localSession.js';
import {createPublicDataServices} from '../data/runtime.js';
import {ProviderStore} from '../shared/providerStore.js';
import {summarizeCalendar,type CalendarSummary} from '../shared/calendarSummary.js';
import type {Cancellation} from '../shared/dataClient.js';
import {DataCancelled} from '../data/errors.js';
export type PublicDataServices=Omit<ReturnType<typeof createPublicDataServices>,'secrets'>&{secrets:import('../data/contracts.js').SecretStore};
/** Preferences owns this session only while no Shell status owner exists. */
export class CalendarPreview {
    private session:LocalWidgetSession;private dead=false;private stopClock:(()=>void)|null=null;
    private instanceId=GLib.uuid_string_random();private revision=0;
    constructor(extensionPath:string,services:PublicDataServices,changed:(summary:CalendarSummary)=>void){
        const provider=new CalendarProvider({...services,files:services.cache,worker:new CalendarWorkerClient(extensionPath),uuid:GLib.uuid_string_random,digest:bytes=>GLib.compute_checksum_for_bytes(GLib.ChecksumType.SHA256,new GLib.Bytes(bytes))!,writeCache:false});
        const store=new ProviderStore();
        this.session=new LocalWidgetSession({extensionPath,store,changed:()=>{
            if(this.dead)return;const value=this.session.calendarStatus();changed(summarizeCalendar(this.instanceId,++this.revision,value.generation,value.state,value.context));
        },connection(){}},{config:services.config,clock:services.clock,drivers:{calendar:provider}});
        const context=()=>{const local=GLib.DateTime.new_now_local();this.session.setCalendarContext({month:local.format('%Y-%m')!,timeZone:GLib.TimeZone.new_local().get_identifier(),weekStart:0},local.format('%F')!);};
        context();this.session.setCalendarWatchers(1);
        // Detect local day/month/timezone changes without importing Shell's clock.
        const tick=()=>{if(this.dead)return;context();this.stopClock=services.clock.schedule(60000,tick);};this.stopClock=services.clock.schedule(60000,tick);
    }
    refresh(cancel:Cancellation):Promise<void>{if(this.dead||cancel.cancelled)return Promise.reject(new DataCancelled());this.session.refresh('calendar');return Promise.resolve();}
    async destroy():Promise<void>{if(this.dead)return;this.dead=true;this.stopClock?.();this.stopClock=null;this.session.destroy();await this.session.drained;}
}
