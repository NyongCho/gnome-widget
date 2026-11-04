import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk?version=4.0';
import Gio from 'gi://Gio';
import {addWeatherSettings} from './weather.js';
import {addCalendarSettings} from './calendar.js';
import {addDisplaySettings,addNetworkSettings} from './placement.js';
import {preferencesLanguage,addLanguageSettings} from './language.js';
import type {Message} from '../shared/i18n.js';
export function fillSettingsWindow(window:Adw.PreferencesWindow,settings:Gio.Settings):void{
 const ui=preferencesLanguage(window,settings);
 window.set_default_size(600,720);
 const page=ui.bind(new Adw.PreferencesPage({name:'widgets',icon_name:'preferences-desktop-display-symbolic'}),{title:'위젯'});
 addLanguageSettings(page,settings,ui);
 const group=ui.bind(new Adw.PreferencesGroup(),{title:'표시할 카드',description:'음악은 재생 중일 때만 표시됩니다.'});page.add(group);
 const titles:Record<string,Message>={clock:'날짜와 시계',calendar:'월간 달력',agenda:'다가오는 일정',weather:'날씨',network:'네트워크',system:'CPU · 메모리 · 온도',media:'음악'};
 for(const [id,title] of Object.entries(titles)){
  const row=ui.bind(new Adw.SwitchRow({active:settings.get_strv('visible').includes(id)}),{title});
  row.connect('notify::active',()=>{const current=settings.get_strv('visible').filter(value=>value!==id);if(row.active)current.push(id);settings.set_strv('visible',current);});group.add(row);
 }
 const appearance=ui.bind(new Adw.PreferencesGroup(),{title:'유리와 크기',description:'유리 농도를 높이면 배경이 더 차분해집니다. 글자 대비는 자동으로 유지합니다.'});page.add(appearance);
 for(const [key,title,min,max,step] of [['scale','전체 크기',.75,1.5,.05],['strength','굴절 강도',0,20,1],['opacity','유리 농도',.05,.8,.05]] as const){
  const row=ui.bind(new Adw.SpinRow({adjustment:new Gtk.Adjustment({lower:min,upper:max,step_increment:step,page_increment:step*2}),digits:2}),{title});
  settings.bind(key,row,'value',Gio.SettingsBindFlags.DEFAULT);appearance.add(row);
 }
 const low=ui.bind(new Adw.SwitchRow(),{title:'저전력 모드',subtitle:'굴절 대신 반투명 배경을 사용합니다.'});settings.bind('low-power',low,'active',Gio.SettingsBindFlags.DEFAULT);appearance.add(low);
 addDisplaySettings(window,page,settings,ui);
 const data=ui.bind(new Adw.PreferencesPage({name:'data',icon_name:'network-server-symbolic'}),{title:'데이터'});
 addCalendarSettings(window,data,ui);addWeatherSettings(window,data,ui);addNetworkSettings(window,data,ui);
 window.add(page);window.add(data);
}
