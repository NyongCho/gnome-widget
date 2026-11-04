import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import {capture,setScale} from './helpers.js';
export const METRICS={};
function check(value,message){if(!value)throw new Error(message);}
function leaves(actor){
    if(!actor.visible)return [];
    if(actor instanceof St.Label)return actor.get_text()?[actor]:[];
    if(actor instanceof St.DrawingArea||actor instanceof St.Icon)return [actor];
    return actor.get_children().flatMap(leaves);
}
function todayBadge(host){
    const find=actor=>actor.has_style_class_name?.('liquid-calendar-today')?actor:actor.get_children().map(find).find(Boolean);
    const badge=find(host.cards.get('calendar').button);
    check(Boolean(badge),'today highlight missing');return badge;
}
async function todayPixels(host,name,scale){
    const badge=todayBadge(host),label=badge instanceof St.Label?badge:leaves(badge).find(a=>a instanceof St.Label);
    const cell=badge instanceof St.Label?badge.get_parent():badge;
    const dots=cell.get_children().filter(a=>a.has_style_class_name?.('liquid-event-dot'));
    for(const dot of dots)dot.opacity=0;
    await Scripting.sleep(40);await capture(name);
    for(const dot of dots)dot.opacity=255;
    const bitmap=GdkPixbuf.Pixbuf.new_from_file(`${GLib.getenv('LIQUID_TEST_OUTPUT')}/${name}.png`);
    const pixels=bitmap.get_pixels(),stride=bitmap.get_rowstride(),channels=bitmap.get_n_channels(),ratio=bitmap.width/global.stage.width;
    const [x,y]=badge.get_transformed_position(),[w,h]=badge.get_transformed_size(),fg=label.get_theme_node().get_foreground_color();
    const ink=[];
    for(let py=Math.ceil(y*ratio);py<Math.floor((y+h)*ratio);py++)for(let px=Math.ceil(x*ratio);px<Math.floor((x+w)*ratio);px++){
        const i=py*stride+px*channels;
        if(Math.max(Math.abs(pixels[i]-fg.red),Math.abs(pixels[i+1]-fg.green),Math.abs(pixels[i+2]-fg.blue))<40)ink.push([px,py]);
    }
    check(ink.length>4,'today numeral missing from screenshot');
    const dx=(Math.min(...ink.map(p=>p[0]))+Math.max(...ink.map(p=>p[0]))+1)/2/ratio-x-w/2;
    const dy=(Math.min(...ink.map(p=>p[1]))+Math.max(...ink.map(p=>p[1]))+1)/2/ratio-y-h/2;
    print(`CALENDAR_PIXELS: ${name} horizontal=${dx.toFixed(2)}px vertical=${dy.toFixed(2)}px`);
    check(Math.abs(dx)<=1.5*scale&&Math.abs(dy)<=1.5*scale,`painted today numeral is off center: ${dx.toFixed(2)}, ${dy.toFixed(2)}px`);
}
function compact(host,scale){
    for(const [id,card] of host.cards){
        check(card.status.visible===Boolean(card.status.get_text()),`${id}: empty status reserves footer space`);
        const [,y]=card.button.get_transformed_position();
        const bottom=Math.max(...leaves(card.button).map(a=>a.get_transformed_position()[1]+a.get_transformed_size()[1]));
        const gap=y+card.button.height-bottom;
        check(gap>=12*scale-1&&gap<=24*scale+1,`${id}: unused bottom space or clipped content (${gap}px)`);
    }
    const calendar=host.cards.get('calendar');
    if(calendar){
        const badge=todayBadge(host);
        const label=badge instanceof St.Label?badge:leaves(badge).find(actor=>actor instanceof St.Label);
        const text=label.clutter_text,ink=text.get_layout().get_pixel_extents()[0];
        const resourceScale=text.get_resource_scale();
        const glyphCenter=text.get_transformed_position()[1]+text.get_layout_offsets()[1]+(ink.y+ink.height/2)/resourceScale;
        const badgeCenter=badge.get_transformed_position()[1]+badge.get_transformed_size()[1]/2;
        const offset=glyphCenter-badgeCenter;
        const horizontal=text.get_transformed_position()[0]+text.get_layout_offsets()[0]+(ink.x+ink.width/2)/resourceScale-(badge.get_transformed_position()[0]+badge.get_transformed_size()[0]/2);
        check(Math.abs(horizontal)<=1.5*scale,`today numeral is not horizontally centered: ${horizontal.toFixed(2)}px; badge=${JSON.stringify([...badge.get_transformed_position(),...badge.get_transformed_size()])}, label=${JSON.stringify([...label.get_transformed_position(),...label.get_transformed_size()])}, text=${JSON.stringify([...text.get_transformed_position(),...text.get_transformed_size()])}`);
        check(Math.abs(offset)<=1.5*scale,`today numeral is not vertically centered: ${offset.toFixed(2)}px at UI scale ${scale}, resourceScale=${text.get_resource_scale()}, textHeight=${text.height}, inkY=${ink.y}, inkHeight=${ink.height}, layoutOffset=${text.get_layout_offsets()[1]}`);
        const cell=badge instanceof St.Label?badge.get_parent():badge;
        for(const dot of cell.get_children().filter(a=>a.has_style_class_name?.('liquid-event-dot'))){
            const dotY=dot.get_transformed_position()[1],dotBottom=dotY+dot.get_transformed_size()[1];
            const cellBottom=cell.get_transformed_position()[1]+cell.get_transformed_size()[1];
            check(Math.abs(dotBottom-cellBottom)<=1&&dotY>=glyphCenter+ink.height/2/resourceScale,'event dot must sit below the numeral at the cell bottom');
        }
        print(`CALENDAR_ALIGNMENT: UI scale=${scale}, vertical ink offset=${offset.toFixed(2)}px`);
    }
}
export async function run(){
    Main.overview.hide();await Scripting.sleep(1500);
    const background=new Gio.Settings({schema_id:'org.gnome.desktop.background'});
    const desktop=new Gio.Settings({schema_id:'org.gnome.desktop.interface'});
    const path=`${GLib.getenv('LIQUID_TEST_OUTPUT')}/reference-gradient.svg`;
    GLib.file_set_contents(path,'<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800"><defs><linearGradient id="g" x2=".4" y2="1"><stop stop-color="#51487e"/><stop offset=".5" stop-color="#79598d"/><stop offset="1" stop-color="#af7a94"/></linearGradient></defs><rect width="1280" height="800" fill="url(#g)"/></svg>');
    const uri=Gio.File.new_for_path(path).get_uri();background.set_string('picture-uri',uri);background.set_string('picture-uri-dark',uri);
    desktop.set_string('color-scheme','prefer-dark');
    await Scripting.sleep(1300); // Let the Shell's wallpaper crossfade finish.
    const ext=Main.extensionManager.lookup('liquid-widgets@local').stateObj;
    ext.clock.destroy();ext.clock=null;ext.client.stop();ext.client=null;
    const host=ext.host,settings=ext.settings;
    settings.set_strv('visible',['clock','calendar','weather','agenda','network','system','media']);
    const now=Date.parse('2026-11-04T04:30:00Z'),updatedAt=new Date(now).toISOString();
    const state=data=>({status:'ok',sourceId:'compact-fixture',updatedAt,errorCode:null,data});
    host.tick(now,'Asia/Seoul',false,'ko-KR',1);host.setConnected(true);
    const calendar=state({month:'2026-11',timeZone:'Asia/Seoul',weekStart:1,events:[1,2,3].map(i=>({uid:`item-${i}`,occurrenceKey:`item-${i}`,title:`테스트 일정 ${i}`,start:new Date(now+i*3600000).toISOString(),end:new Date(now+(i+1)*3600000).toISOString(),allDay:false}))});
    const weather=state({location:'서울특별시 · 대한민국',timeZone:'Asia/Seoul',current:{temperatureC:16,code:2},hourly:Array.from({length:6},(_,i)=>({at:new Date(now+(i+1)*3600000).toISOString(),temperatureC:16-i,precipitationProbability:10*i})),attributionUrl:'https://open-meteo.com/'});
    host.updateProvider('calendar',calendar);host.updateProvider('weather',weather);
    host.updateProvider('network',state({interface:'test0',rxBytesPerSec:1024,txBytesPerSec:512,history:[{at:new Date(now-1000).toISOString(),rx:100,tx:50},{at:updatedAt,rx:1024,tx:512}]}));
    host.updateProvider('system',state({cpuPercent:12,memoryUsedBytes:4*2**30,memoryTotalBytes:32*2**30,temperatureC:43}));
    host.updateProvider('media',state({player:'org.mpris.MediaPlayer2.fixture',status:'playing',title:'테스트 음악',artist:'Test artist',artUri:null}));
    ext.layout();await Scripting.sleep(300);
    check(host.connected&&host.cards.get('weather').status.get_text()==='','fixture must stay connected without a live data client');
    await capture('compact-ready');compact(host,1);
    await todayPixels(host,'calendar-pixels-dark',1);
    const sizes=Object.fromEntries([...host.cards].map(([id,card])=>[id,{height:card.button.height,titleFont:card.title.get_theme_node().get_font().to_string()}]));
    desktop.set_string('color-scheme','prefer-light');await Scripting.sleep(150);compact(host,1);await capture('compact-ready-light');await todayPixels(host,'calendar-pixels-light',1);
    desktop.set_string('color-scheme','prefer-dark');await Scripting.sleep(150);
    const oldHeight=host.cards.get('weather').button.height;
    host.updateProvider('weather',{...weather,status:'stale',errorCode:'NETWORK_ERROR'});await Scripting.sleep(200);
    const changed=host.cards.get('weather');
    check(changed.button.height>oldHeight,`error message did not get additional space: before=${oldHeight}, after=${changed.button.height}, natural=${changed.content.get_preferred_height(changed.button.width)[1]}, status=${changed.status.visible}`);
    GLib.file_set_contents(`${GLib.getenv('LIQUID_TEST_OUTPUT')}/sizes.json`,JSON.stringify({ready:sizes,weatherWithError:changed.button.height},null,2));
    compact(host,1);await capture('compact-error');
    host.updateProvider('weather',weather);await Scripting.sleep(200);
    check(host.cards.get('weather').button.height===oldHeight,'recovery retains error footer space');
    const before=host.cards.get('clock').surface.diagnostics.inputPaints;
    host.tick(now+1000,'Asia/Seoul',false,'ko-KR',1);await Scripting.sleep(150);
    check(host.cards.get('clock').surface.diagnostics.inputPaints===before,'unchanged clock height invalidates glass cache');
    host.updateProvider('calendar',{...calendar,data:{...calendar.data,events:[]}});await Scripting.sleep(150);compact(host,1);
    await capture('compact-no-events');
    for(const language of ['ko','en']){
        settings.set_string('language',language);settings.set_double('scale',1.5);await Scripting.sleep(250);compact(host,1.5);
        await capture(`compact-${language}-large`);
        await todayPixels(host,`calendar-pixels-${language}-large`,1.5);
    }
    settings.set_double('scale',1);settings.set_string('language','ko');await Scripting.sleep(100);
    host.layout({monitor:'primary',anchor:'top-right',offsetX:24,offsetY:20,scale:1,visible:settings.get_strv('visible')},{x:900,y:40,width:300,height:420},0);
    await Scripting.sleep(250);compact(host,1);await capture('compact-narrow');
    ext.layout();await setScale(1.25);await capture('compact-125');compact(host,1);await todayPixels(host,'calendar-pixels-125',1);
    print('COMPACT_TEST: content fit, error/recovery, empty agenda, scale, languages, narrow layout and glass cache passed');
}
