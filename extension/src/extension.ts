import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import Gio from 'gi://Gio';
import {SessionTransport} from './dbus.js';
import {DataClient} from './shared/dataClient.js';
import {ProviderStore,PROVIDERS} from './shared/providerStore.js';
import {DesktopLayerAdapter} from './platform/desktopLayer.js';
import {WidgetHost} from './widgets/host.js';
import {ClockController} from './clock.js';
import {clockValues} from './shared/clockValues.js';
import {desktopWorkarea,watchDesktopLayout} from './layout.js';
import {requestedProviders} from './shared/liveData.js';
import {initializeCardOrder} from './cardSettings.js';
import type {LayoutConfig} from './shared/layout.js';
export default class LiquidWidgets extends Extension {
    private layer:DesktopLayerAdapter|null=null;
    private host:WidgetHost|null=null;
    private clock:ClockController|null=null;
    private client:DataClient|null=null;
    private settings:Gio.Settings|null=null;
    private settingsChanged=0;
    private subscribed='';
    private unwatch:(()=>void)|null=null;
    enable():void{
        this.settings=this.getSettings();
        initializeCardOrder(this.settings);
        this.layer=new DesktopLayerAdapter();
        this.host=new WidgetHost(this.settings,()=>{void this.openPreferences();});
        this.layer.actor.add_child(this.host.actor);
        this.unwatch=watchDesktopLayout(()=>this.layout());
        this.settingsChanged=this.settings.connect('changed',(_settings,key)=>{
            if(key==='card-order'&&this.settings)initializeCardOrder(this.settings);
            this.syncProviders();this.layout();
        });
        const store=new ProviderStore();
        this.client=new DataClient(new SessionTransport(),store,provider=>{
            const before=this.host?.visibleCards.join(',');
            if(provider)this.host?.updateProvider(provider,store.get(provider));
            else for(const name of PROVIDERS)this.host?.updateProvider(name,store.get(name));
            if(!provider||before!==this.host?.visibleCards.join(','))this.layout();
        },state=>this.host?.setConnected(state==='connected'));
        this.syncProviders();
        this.clock=new ClockController();
        this.clock.start(now=>{const clock=this.clock!;this.host?.tick(now,clock.timeZone,clock.hour12,clock.locale,clock.weekStart);
            const today=clockValues(now,clock.timeZone,clock.hour12,clock.locale).today;
            this.client?.setCalendarContext({month:today.slice(0,7),timeZone:clock.timeZone,weekStart:clock.weekStart},today);},()=>this.client?.refreshAfterResume());
        this.layout();
    }
    private syncProviders():void{
        if(!this.settings||!this.client)return;
        const providers=requestedProviders(this.settings.get_strv('visible')),key=providers.join(',');
        if(key===this.subscribed)return;this.subscribed=key;
        if(providers.length)this.client.start(providers);else this.client.stop();
    }
    private layout():void{
        if(!this.settings||!this.host)return;
        const placement=desktopWorkarea(this.settings.get_string('monitor'));
        if(!placement){this.host.actor.hide();return;}
        this.host.actor.show();
        const config:LayoutConfig={monitor:this.settings.get_string('monitor'),anchor:this.settings.get_string('anchor') as LayoutConfig['anchor'],offsetX:this.settings.get_int('offset-x'),offsetY:this.settings.get_int('offset-y'),scale:this.settings.get_double('scale'),visible:this.settings.get_strv('visible')};
        this.host.layout(config,placement.area,placement.index);
    }
    disable():void{
        this.subscribed='';this.client?.stop();this.client=null;this.clock?.destroy();this.clock=null;
        this.unwatch?.();this.unwatch=null;
        if(this.settingsChanged)this.settings?.disconnect(this.settingsChanged);
        this.settingsChanged=0;this.settings=null;
        this.host?.destroy();this.host=null;this.layer?.destroy();this.layer=null;
    }
}
