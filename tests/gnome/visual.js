import Gio from 'gi://Gio';import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';import {capture,setScale} from './helpers.js';
export const METRICS={};
export async function run(){
 Main.overview.hide();await Scripting.sleep(1500);const ext=Main.extensionManager.lookup('liquid-widgets@local');const settings=ext.stateObj.settings;
 const background=new Gio.Settings({schema_id:'org.gnome.desktop.background'});
 for(const [name,color] of [['bright','#f5f7fb'],['dark','#101625']]){
  const path=`${GLib.getenv('LIQUID_TEST_OUTPUT')}/${name}.svg`;GLib.file_set_contents(path,`<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800"><rect width="1280" height="800" fill="${color}"/><path d="M0 600 Q450 250 1280 300" fill="none" stroke="${name==='bright'?'#dce6f1':'#526180'}" stroke-width="160"/></svg>`);
  background.set_string('picture-uri',Gio.File.new_for_path(path).get_uri());background.set_string('picture-uri-dark',Gio.File.new_for_path(path).get_uri());settings.set_double('opacity',.24);await Scripting.sleep(1200);await capture(`widgets-${name}-default`);
  if(name==='bright'){settings.set_double('opacity',.5);await Scripting.sleep(200);await capture('widgets-bright-more-tint');}
 }
 await setScale(1.25);await capture('widgets-dark-125');
 print('VISUAL_TEST: bright/dark backgrounds, opacity and 125 percent captures complete');
}
