import St from 'gi://St';
import {SessionTransport} from './dbus.js';
import {DataClient} from './shared/dataClient.js';
import {ProviderStore,PROVIDERS} from './shared/providerStore.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {GlassSurface} from './effects/background.js';
import {DesktopLayerAdapter} from './platform/desktopLayer.js';
export default class LiquidWidgets extends Extension {
    clickCount = 0;
    private client: DataClient | null = null;
    private strength = 16;
    private button: St.Button | null = null;
    private surface: GlassSurface | null = null;
    private layer: DesktopLayerAdapter | null = null;
    enable():void {
        this.layer = new DesktopLayerAdapter();
        this.surface = new GlassSurface(0);
        this.surface.setGeometry({x:420,y:200,width:340,height:230},1);
        this.layer.actor.add_child(this.surface.actor);
        const label = new St.Label({text:'Liquid Glass',x:24,y:24,style:'color:#ffffff;font-size:26px;font-weight:600;'});
        const subtitle = new St.Label({text:'GNOME 50 • wallpaper refraction',x:24,y:65,style:'color:rgba(255,255,255,.85);font-size:14px;'});
        this.surface.actor.add_child(label); this.surface.actor.add_child(subtitle);
        const hint = new St.Label({x:24,y:100,style:'color:rgba(255,255,255,.8);font-size:12px;'});
        this.surface.actor.add_child(hint);
        this.client = new DataClient(new SessionTransport(),new ProviderStore(),()=>{},state=>{
            subtitle.set_text(state==='connected'?'데이터 서비스 연결됨':state==='connecting'?'데이터 서비스 연결 중…':state==='invalid-data'?'데이터 형식을 확인할 수 없어요':'데이터 서비스 연결 필요');
            hint.set_text(state==='disconnected'?'사용자 서비스를 설치·시작해 주세요':state==='unavailable'?'잠시 후 자동으로 다시 연결합니다':'');
        });
        this.client.start([...PROVIDERS]);
        this.button = new St.Button({label:'Refraction · on',can_focus:true,reactive:true,x:24,y:145,width:170,height:44,style:'background-color:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.32);border-radius:14px;color:white;font-size:14px;'});
        this.button.connect('clicked',()=>{ this.clickCount++; this.setStrength(this.strength>0?0:16); });
        this.surface.actor.add_child(this.button);
    }
    setStrength(value:number):void { this.strength=value; this.surface?.setStrength(value); this.button?.set_label(value>0?'Refraction · on':'Refraction · off'); }
    get diagnostics():object|null { return this.surface?.diagnostics ?? null; }
    disable():void { this.client?.stop(); this.client=null; this.surface?.destroy(); this.surface=null; this.button=null; this.layer?.destroy(); this.layer=null; }
}
