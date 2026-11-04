import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk?version=4.0';
import Gio from 'gi://Gio';
import {TextBindings} from '../shared/i18n.js';
/** GTK can keep a closed window alive until JS references are collected. */
export function onPreferencesClosed(window:Adw.PreferencesWindow,cleanup:()=>void):void{
 let closed=false;
 const release=()=>{if(!closed){closed=true;cleanup();}};
 window.connect('close-request',()=>{release();return false;});
 window.connect('destroy',release);
}
export function preferencesLanguage(window:Adw.PreferencesWindow,settings:Gio.Settings):TextBindings{
 const ui=new TextBindings(settings.get_string('language'));
 const signal=settings.connect('changed::language',()=>ui.setLanguage(settings.get_string('language')));
 onPreferencesClosed(window,()=>{settings.disconnect(signal);ui.destroy();});
 return ui;
}
export function addLanguageSettings(page:Adw.PreferencesPage,settings:Gio.Settings,ui:TextBindings):void{
 const group=ui.bind(new Adw.PreferencesGroup(),{title:'표시 언어'});
 const values=['ko','en'];
 const row=ui.bind(new Adw.ComboRow({model:Gtk.StringList.new(['한국어','English']),selected:values.indexOf(ui.language)}),{title:'언어 / Language',subtitle:'위젯과 설정에 바로 적용됩니다.'});
 row.connect('notify::selected',()=>{const value=values[row.selected];if(value&&value!==settings.get_string('language'))settings.set_string('language',value);});
 ui.onChange(()=>{row.selected=values.indexOf(ui.language);});
 group.add(row);page.add(group);
}
