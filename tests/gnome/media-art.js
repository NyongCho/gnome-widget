import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import {capture,setScale} from './helpers.js';
export const METRICS={};
function check(ok,message){if(!ok)throw new Error(message);}
const output=GLib.getenv('LIQUID_TEST_OUTPUT');
function fixture(name,width,height){
    const image=GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB,false,8,width,height);
    image.fill(0xff00ffff);const path=`${output}/${name}.png`;image.savev(path,'png',[],[]);
    return Gio.File.new_for_path(path).get_uri();
}
function pixels(name,actor){
    const bitmap=GdkPixbuf.Pixbuf.new_from_file(`${output}/${name}.png`);
    const bytes=bitmap.get_pixels(),stride=bitmap.get_rowstride(),channels=bitmap.get_n_channels(),scale=bitmap.width/global.stage.width;
    const [x,y]=actor.get_transformed_position(),[w,h]=actor.get_transformed_size(),found=[];
    for(let py=Math.ceil(y*scale);py<Math.floor((y+h)*scale);py++)for(let px=Math.ceil(x*scale);px<Math.floor((x+w)*scale);px++){
        const i=py*stride+px*channels;
        if(bytes[i]>220&&bytes[i+1]<50&&bytes[i+2]>220)found.push([px,py]);
    }
    if(!found.length)return null;
    return {width:(Math.max(...found.map(p=>p[0]))-Math.min(...found.map(p=>p[0]))+1)/scale,height:(Math.max(...found.map(p=>p[1]))-Math.min(...found.map(p=>p[1]))+1)/scale};
}
export async function run(){
    Main.overview.hide();await Scripting.sleep(1500);
    const ext=Main.extensionManager.lookup((GLib.getenv('LIQUID_TEST_UUID')||'liquid-widgets@local')).stateObj;
    ext.client.destroy();ext.client=null;ext.clock.destroy();ext.clock=null;
    ext.settings.set_strv('visible',['media']);ext.host.setConnected(true);
    const fixtures=[['wide',160,90],['square',90,90],['portrait',90,160]].map(([name,w,h])=>({name,w,h,uri:fixture(name,w,h)}));
    const data=uri=>({status:'ok',sourceId:'art-fixture',updatedAt:'2026-11-04T04:30:00Z',errorCode:null,data:{player:'org.mpris.MediaPlayer2.fixture',status:'playing',title:'Artwork test',artist:'Test artist',artUri:uri}});
    const render=uri=>{ext.host.updateProvider('media',data(uri));ext.layout();};
    const art=()=>ext.host.cards.get('media').body.get_first_child().get_first_child();
    const report=[];
    for(const displayScale of [1,1.25]){
        await setScale(displayScale);
        for(const item of fixtures){
            render(item.uri);const name=`art-${item.name}-${displayScale}`;let painted=null;
            for(let n=0;n<20&&!painted;n++){await Scripting.sleep(100);await capture(name);painted=pixels(name,art());}
            check(Boolean(painted),`${item.name}: artwork never became visible`);
            const ratio=painted.width/painted.height;report.push({name,displayScale,...painted,ratio});
            print(`MEDIA_ART_TEST: ${name} painted=${painted.width}x${painted.height} ratio=${ratio.toFixed(3)}`);
            check(Math.abs(ratio-item.w/item.h)<.1,`${item.name}: artwork is stretched (${ratio.toFixed(3)} instead of ${(item.w/item.h).toFixed(3)})`);
        }
    }
    GLib.file_set_contents(`${output}/invalid.png`,'Not an image');
    for(const filename of ['missing','invalid']){
        render(Gio.File.new_for_path(`${output}/${filename}.png`).get_uri());await Scripting.sleep(300);await capture(`art-${filename}`);
        check(art().get_first_child().visible&&art().width>0&&art().height>0,'failed art lost its fallback');
        check(ext.host.cards.get('media').body.get_children()[0].get_children()[1].get_children()[0].get_text()==='Artwork test','art failure lost the track title');
    }
    for(let i=0;i<10;i++){render(fixtures[0].uri);render(fixtures[1].uri);}
    await Scripting.sleep(300);await capture('art-replaced');
    const final=pixels('art-replaced',art());check(final&&Math.abs(final.width/final.height-1)<.1,'old rectangular image replaced the new square');
    render(fixtures[0].uri);ext.settings.set_strv('visible',[]);await Scripting.sleep(300);
    check(ext.host.cards.size===0,'closing a pending artwork retained its card');
    GLib.file_set_contents(`${output}/dimensions.json`,JSON.stringify(report,null,2));
    print('MEDIA_ART_TEST: aspect ratios, fractional scale, missing image, replacement and close passed');
}
