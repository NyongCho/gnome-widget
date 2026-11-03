import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk?version=4.0';
import Gio from 'gi://Gio';
import {addWeatherSettings} from './weather.js';
import {addCalendarSettings} from './calendar.js';
import {addDisplaySettings,addNetworkSettings} from './placement.js';
export function fillSettingsWindow(window:Adw.PreferencesWindow,settings:Gio.Settings):void{
        window.set_default_size(600,720);
        const page=new Adw.PreferencesPage({name:'widgets',title:'위젯',icon_name:'preferences-desktop-display-symbolic'});
        const group=new Adw.PreferencesGroup({title:'표시할 카드',description:'음악은 재생 중일 때만 표시됩니다.'});page.add(group);
        const titles:Record<string,string>={clock:'날짜와 시계',calendar:'월간 달력',agenda:'다가오는 일정',weather:'날씨',network:'네트워크',system:'CPU · 메모리 · 온도',media:'음악'};
        for(const [id,title] of Object.entries(titles)){
            const row=new Adw.SwitchRow({title,active:settings.get_strv('visible').includes(id)});
            row.connect('notify::active',()=>{const current=settings.get_strv('visible').filter(value=>value!==id);if(row.active)current.push(id);settings.set_strv('visible',current);});group.add(row);
        }
        const appearance=new Adw.PreferencesGroup({title:'유리와 크기',description:'밝은 배경에서는 불투명도를 0.5 이상으로 높이면 작은 글자가 더 잘 보입니다.'});page.add(appearance);
        for(const [key,title,min,max,step] of [['scale','전체 크기',.75,1.5,.05],['strength','굴절 강도',0,20,1],['opacity','불투명도',.05,.8,.05]] as const){
            const row=new Adw.SpinRow({title,adjustment:new Gtk.Adjustment({lower:min,upper:max,step_increment:step,page_increment:step*2}),digits:2});
            settings.bind(key,row,'value',Gio.SettingsBindFlags.DEFAULT);appearance.add(row);
        }
        const low=new Adw.SwitchRow({title:'저전력 모드',subtitle:'굴절 대신 반투명 배경을 사용합니다.'});settings.bind('low-power',low,'active',Gio.SettingsBindFlags.DEFAULT);appearance.add(low);
        addDisplaySettings(window,page,settings);
        const data=new Adw.PreferencesPage({name:'data',title:'데이터',icon_name:'network-server-symbolic'});addCalendarSettings(window,data);addWeatherSettings(window,data);addNetworkSettings(window,data);
        window.add(page);window.add(data);
}
