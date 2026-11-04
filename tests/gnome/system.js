import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import GdkPixbuf from 'gi://GdkPixbuf';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import {capture,setScale} from './helpers.js';
export const METRICS={};
function check(ok,message){if(!ok)throw new Error(message);}
function descendants(actor){return [actor,...actor.get_children().flatMap(descendants)];}
const output=GLib.getenv('LIQUID_TEST_OUTPUT');
function paintedQuadrants(name,ring){
    const image=GdkPixbuf.Pixbuf.new_from_file(`${output}/${name}.png`),bytes=image.get_pixels();
    const density=image.width/global.stage.width,channels=image.get_n_channels(),stride=image.get_rowstride();
    const [x,y]=ring.get_transformed_position(),[w,h]=ring.get_transformed_size(),fg=ring.get_theme_node().get_foreground_color();
    return [45,135,225,315].map(degrees=>{
        const angle=(degrees-90)*Math.PI/180,radius=Math.min(w,h)*.44;
        const px=Math.round((x+w/2+Math.cos(angle)*radius)*density),py=Math.round((y+h/2+Math.sin(angle)*radius)*density);
        const i=py*stride+px*channels;
        return Math.max(Math.abs(bytes[i]-fg.red),Math.abs(bytes[i+1]-fg.green),Math.abs(bytes[i+2]-fg.blue))<35;
    });
}
export async function run(){
    Main.overview.hide();await Scripting.sleep(1500);
    const ext=Main.extensionManager.lookup('liquid-widgets@local').stateObj;
    ext.clock.destroy();ext.clock=null;ext.client.stop();ext.client=null;
    const settings=ext.settings,desktop=new Gio.Settings({schema_id:'org.gnome.desktop.interface'});
    settings.set_strv('visible',['system']);ext.host.setConnected(true);
    const base={cpuPercent:25,memoryUsedBytes:16*2**30,memoryTotalBytes:32*2**30,temperatureC:43};
    const render=changes=>{ext.host.updateProvider('system',{status:'ok',sourceId:'system-fixture',updatedAt:'2026-11-04T04:30:00Z',errorCode:null,data:{...base,...changes}});ext.layout();};
    const rings=()=>descendants(ext.host.cards.get('system').body).filter(a=>a instanceof St.DrawingArea);
    const texts=()=>descendants(ext.host.cards.get('system').body).filter(a=>a instanceof St.Label).map(a=>a.get_text());
    render({});await Scripting.sleep(200);await capture('system-before-or-default');
    check(rings().length===2,'system card must display two usage donut gauges');
    const report=[];
    async function verify(name,expected,values){
        await Scripting.sleep(200);await capture(name);
        const actual=rings().map(ring=>paintedQuadrants(name,ring));
        check(JSON.stringify(actual)===JSON.stringify(expected),`${name}: wrong painted usage ${JSON.stringify(actual)}`);
        for(const value of values)check(texts().includes(value),`${name}: missing metric ${value}`);
        for(const ring of rings()){
            const [w,h]=ring.get_transformed_size();check(Math.abs(w-h)<1,'donut was stretched');
            const frame=ring.get_parent(),value=frame.get_children().find(a=>a instanceof St.Label);
            const [x,y]=value.get_transformed_position(),[vw,vh]=value.get_transformed_size();
            const [rx,ry]=ring.get_transformed_position();
            check(Math.abs(x+vw/2-rx-w/2)<=1&&Math.abs(y+vh/2-ry-h/2)<=1,'percentage label is off-center');
        }
        report.push({name,quadrants:actual,text:texts(),height:ext.host.cards.get('system').button.height});
    }
    for(const theme of ['prefer-dark','prefer-light']){
        desktop.set_string('color-scheme',theme);render({});
        await verify(`system-${theme}`,[[true,false,false,false],[true,true,false,false]],['25%','50%','CPU','RAM','RAM  16.0 / 32.0 GiB','CPU 온도  43°C']);
    }
    render({cpuPercent:0,memoryUsedBytes:32*2**30});
    await verify('system-zero-full',[[false,false,false,false],[true,true,true,true]],['0%','100%']);
    render({cpuPercent:null,memoryUsedBytes:0,memoryTotalBytes:0,temperatureC:null});
    await verify('system-unknown',[[false,false,false,false],[false,false,false,false]],['—','CPU 온도 센서 없음']);
    settings.set_string('language','en');render({cpuPercent:null,temperatureC:null});
    await verify('system-english',[[false,false,false,false],[true,true,false,false]],['—','CPU temperature sensor unavailable']);
    settings.set_double('scale',1.5);render({});
    await verify('system-large',[[true,false,false,false],[true,true,false,false]],['25%','50%']);
    settings.set_double('scale',1);settings.set_string('language','ko');desktop.set_string('color-scheme','prefer-dark');render({});await setScale(1.25);
    await verify('system-125',[[true,false,false,false],[true,true,false,false]],['25%','50%']);
    settings.set_strv('visible',[]);await Scripting.sleep(100);check(ext.host.cards.size===0,'system gauges survived card teardown');
    GLib.file_set_contents(`${output}/measurements.json`,JSON.stringify(report,null,2));
    print('SYSTEM_TEST: painted usage, zero/unknown/full, theme, scale, language, centering and teardown passed');
}
