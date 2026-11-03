import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GnomeDesktop from 'gi://GnomeDesktop?version=4.0';
import Shell from 'gi://Shell';
import * as LoginManager from 'resource:///org/gnome/shell/misc/loginManager.js';
import {millisecondsToNextMinute} from './shared/clockValues.js';
export class ClockController {
    private timer=0;
    private clock=new GnomeDesktop.WallClock();
    private settings=new Gio.Settings({schema_id:'org.gnome.desktop.interface'});
    private login=LoginManager.getLoginManager();
    private signals:{object:{disconnect:(id:number)=>void};id:number}[]=[];
    private callback:((nowMs:number)=>void)|null=null;
    get timeZone():string{return this.clock.get_timezone().get_identifier();}
    get hour12():boolean{return this.settings.get_string('clock-format')==='12h';}
    get locale():string {const raw=(GLib.get_language_names()[0]??'en_US').split('.')[0]!.split('@')[0]!;return raw==='C'||raw==='POSIX'?'en-US':raw.replaceAll('_','-');}
    get weekStart():number{return Shell.util_get_week_start();}
    start(onTick:(nowMs:number)=>void):void {
        this.callback=onTick;
        this.signals.push({object:this.clock,id:this.clock.connect('notify::clock',()=>this.tick())});
        this.signals.push({object:this.clock,id:this.clock.connect('notify::timezone',()=>this.tick())});
        this.signals.push({object:this.settings,id:this.settings.connect('changed::clock-format',()=>this.tick())});
        this.signals.push({object:this.login,id:this.login.connect('prepare-for-sleep',(_object:unknown,sleeping:boolean)=>{if(!sleeping)this.tick();})});
        this.tick();
    }
    private tick():void {
        if(this.timer){GLib.source_remove(this.timer);this.timer=0;}
        this.callback?.(Date.now());
        this.timer=GLib.timeout_add(GLib.PRIORITY_DEFAULT,millisecondsToNextMinute(Date.now()),()=>{this.timer=0;this.tick();return GLib.SOURCE_REMOVE;});
    }
    destroy():void {
        if(this.timer)GLib.source_remove(this.timer);this.timer=0;
        for(const {object,id} of this.signals)object.disconnect(id);this.signals=[];
        this.callback=null;this.clock.run_dispose();
    }
}
