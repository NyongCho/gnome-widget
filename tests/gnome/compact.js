import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
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
function compact(host,scale){
    for(const [id,card] of host.cards){
        check(card.status.visible===Boolean(card.status.get_text()),`${id}: empty status reserves footer space`);
        const [,y]=card.button.get_transformed_position();
        const bottom=Math.max(...leaves(card.button).map(a=>a.get_transformed_position()[1]+a.get_transformed_size()[1]));
        const gap=y+card.button.height-bottom;
        check(gap>=12*scale-1&&gap<=24*scale+1,`${id}: unused bottom space or clipped content (${gap}px)`);
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
    const sizes=Object.fromEntries([...host.cards].map(([id,card])=>[id,{height:card.button.height,titleFont:card.title.get_theme_node().get_font().to_string()}]));
    desktop.set_string('color-scheme','prefer-light');await Scripting.sleep(150);compact(host,1);await capture('compact-ready-light');
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
    }
    settings.set_double('scale',1);settings.set_string('language','ko');await Scripting.sleep(100);
    host.layout({monitor:'primary',anchor:'top-right',offsetX:24,offsetY:20,scale:1,visible:settings.get_strv('visible')},{x:900,y:40,width:300,height:420},0);
    await Scripting.sleep(250);compact(host,1);await capture('compact-narrow');
    ext.layout();await setScale(1.25);compact(host,1);await capture('compact-125');
    print('COMPACT_TEST: content fit, error/recovery, empty agenda, scale, languages, narrow layout and glass cache passed');
}
