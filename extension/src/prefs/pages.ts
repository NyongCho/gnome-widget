import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk?version=4.0';
import Gio from 'gi://Gio';
import {addWeatherSettings} from './weather.js';
import {addCalendarSettings} from './calendar.js';
import {addDisplaySettings,addNetworkSettings} from './placement.js';
import type {PreferencesDataSession} from '../backend/contracts.js';
import {createPreferencesDataSession} from './factory.js';
import {preferencesLanguage,addLanguageSettings,onPreferencesClosed} from './language.js';
import {addCardSettings} from './cards.js';
import {addClockSettings} from './clock.js';
export function fillSettingsWindow(window:Adw.PreferencesWindow,settings:Gio.Settings,extensionPath:string,session:PreferencesDataSession=createPreferencesDataSession(extensionPath)):void{
 const ui=preferencesLanguage(window,settings);onPreferencesClosed(window,()=>session.destroy());
 window.set_default_size(600,720);
 const page=ui.bind(new Adw.PreferencesPage({name:'widgets',icon_name:'preferences-desktop-display-symbolic'}),{title:'위젯'});
 addLanguageSettings(page,settings,ui);
 addCardSettings(window,page,settings,ui);
 addClockSettings(window,page,settings,ui);
 const appearance=ui.bind(new Adw.PreferencesGroup(),{title:'유리와 크기',description:'유리 농도를 높이면 배경이 더 차분해집니다. 글자 대비는 자동으로 유지합니다.'});page.add(appearance);
 for(const [key,title,min,max,step] of [['scale','전체 크기',.75,1.5,.05],['strength','굴절 강도',0,20,1],['opacity','유리 농도',.05,.8,.05]] as const){
  const row=ui.bind(new Adw.SpinRow({adjustment:new Gtk.Adjustment({lower:min,upper:max,step_increment:step,page_increment:step*2}),digits:2}),{title});
  settings.bind(key,row,'value',Gio.SettingsBindFlags.DEFAULT);appearance.add(row);
 }
 const low=ui.bind(new Adw.SwitchRow(),{title:'저전력 모드',subtitle:'굴절 대신 반투명 배경을 사용합니다.'});settings.bind('low-power',low,'active',Gio.SettingsBindFlags.DEFAULT);appearance.add(low);
 addDisplaySettings(window,page,settings,ui);
 const data=ui.bind(new Adw.PreferencesPage({name:'data',icon_name:'network-server-symbolic'}),{title:'데이터'});
 addCalendarSettings(window,data,ui,session);addWeatherSettings(window,data,ui,session);addNetworkSettings(window,data,ui,session);
 window.add(page);window.add(data);
}
