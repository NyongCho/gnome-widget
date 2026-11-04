// A narrow wallpaper line must blur into one smooth stripe, never repeated
// bright/dark stripes. Sparse sampling in both axes makes a visible grid.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import {capture,setScale} from './helpers.js';
export const METRICS={};
export async function run(){
    Main.overview.hide();await Scripting.sleep(1500);
    const extension=Main.extensionManager.lookup('liquid-widgets@local').stateObj;
    extension.settings.set_strv('visible',['clock']);
    extension.settings.set_double('strength',0);
    extension.settings.set_double('opacity',.05);
    new Gio.Settings({schema_id:'org.gnome.desktop.interface'}).set_string('color-scheme','prefer-dark');
    const background=new Gio.Settings({schema_id:'org.gnome.desktop.background'});
    background.set_string('picture-options','stretched');
    const results=[],failures=[];
    for(const scale of [1,1.25]){
        await setScale(scale);
        const card=extension.host.cards.get('clock');card.button.opacity=0;
        const [x,y]=card.button.get_transformed_position();
        const cx=Math.floor(x+card.button.width/2),cy=Math.floor(y+card.button.height/2);
        for(const axis of ['x','y']){
            const name=`blur-${axis}-${scale}`,path=`${GLib.getenv('LIQUID_TEST_OUTPUT')}/${name}.svg`;
            const stripe=axis==='x'?`x="${cx-1}" y="${cy-45}" width="2" height="90"`:`x="${cx-90}" y="${cy-1}" width="180" height="2"`;
            GLib.file_set_contents(path,`<svg xmlns="http://www.w3.org/2000/svg" width="${global.stage.width}" height="${global.stage.height}"><rect width="100%" height="100%" fill="#404040"/><rect ${stripe} fill="#eeeeee"/></svg>`);
            const uri=Gio.File.new_for_path(path).get_uri();background.set_string('picture-uri',uri);background.set_string('picture-uri-dark',uri);
            await Scripting.sleep(1300);await capture(name);
            const bitmap=GdkPixbuf.Pixbuf.new_from_file(`${GLib.getenv('LIQUID_TEST_OUTPUT')}/${name}.png`);
            const pixels=bitmap.get_pixels(),channels=bitmap.get_n_channels(),stride=bitmap.get_rowstride(),ratio=bitmap.width/global.stage.width;
            const sample=(dx,dy)=>pixels[Math.floor((cy+dy)*ratio)*stride+Math.floor((cx+dx)*ratio)*channels];
            const traces=[-1,1].map(direction=>Array.from({length:26},(_,i)=>axis==='x'?sample(direction*i,0):sample(0,direction*i)));
            // Ignore at most two logical pixels of raster alignment at the peak.
            const rebound=Math.max(...traces.map(trace=>Math.max(...trace.slice(2).map((v,i)=>v-Math.min(...trace.slice(1,i+3))))));
            const contrast=Math.max(...traces.flat())-Math.min(...traces.flat());
            const floor=Math.min(...traces.flat());
            const spread=traces[0].filter(v=>v>floor+5).length+traces[1].filter(v=>v>floor+5).length-1;
            results.push({axis,scale,rebound,contrast,spread,traces});
            if(rebound>2||contrast<8||spread<8)failures.push(`${axis}/${scale}: rebound=${rebound}, contrast=${contrast}, spread=${spread}`);
            print(`BLUR_TEST: axis=${axis} scale=${scale} secondaryPeak=${rebound} contrast=${contrast}`);
        }
    }
    GLib.file_set_contents(`${GLib.getenv('LIQUID_TEST_OUTPUT')}/blur-profiles.json`,JSON.stringify(results,null,2));
    // Optional local wallpaper comparison in this isolated session. Only the
    // clock is visible; the real daemon/calendar never joins the private bus.
    const photo=GLib.getenv('LIQUID_TEST_WALLPAPER');
    if(photo){
        await setScale(1);
        const uri=Gio.File.new_for_path(photo).get_uri();
        background.set_string('picture-uri',uri);background.set_string('picture-uri-dark',uri);
        await Scripting.sleep(1300);await capture('photo-material');
        extension.host.cards.get('clock').button.opacity=255;await capture('photo-clock');
    }
    if(failures.length)throw new Error(`Wallpaper blur creates repeated stripes: ${failures.join('; ')}`);
    print('BLUR_TEST: no repeated stripes on either axis at 100% and 125%');
}
