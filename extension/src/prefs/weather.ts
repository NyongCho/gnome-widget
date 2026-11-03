import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk?version=4.0';
import {SessionTransport,BUS_NAME} from '../dbus.js';
import {Cancellation} from '../shared/dataClient.js';
import {parseSettings,parseLocationSearchResults} from '../shared/validation.js';
import type {WeatherLocation} from '../types.js';
export function addWeatherSettings(window:Adw.PreferencesWindow,page:Adw.PreferencesPage):void{
    const wire=new SessionTransport(),cancel=new Cancellation();let closed=false;
    window.connect('destroy',()=>{closed=true;cancel.cancel();});
    const group=new Adw.PreferencesGroup({title:'날씨 지역',description:'선택한 도시의 현재 날씨와 앞으로 6시간 예보를 표시합니다.'});page.add(group);
    const current=new Adw.ActionRow({title:'선택한 지역',subtitle:'확인 중…'});group.add(current);
    const clear=new Gtk.Button({label:'해제',valign:Gtk.Align.CENTER});current.add_suffix(clear);
    const entry=new Adw.EntryRow({title:'도시 이름'});const search=new Gtk.Button({label:'검색',valign:Gtk.Align.CENTER});entry.add_suffix(search);group.add(entry);
    const message=new Gtk.Label({label:'두 글자 이상 입력해 검색하세요.',wrap:true,xalign:0,margin_top:8,margin_bottom:8});group.add(message);
    const results=new Adw.PreferencesGroup({title:'검색 결과',visible:false});page.add(results);
    let rows:Adw.ActionRow[]=[];
    const empty=()=>{for(const row of rows)results.remove(row);rows=[];results.visible=false;};
    const load=async()=>{
        try{const [raw]=await wire.call(BUS_NAME,'GetSettings',[],cancel);if(!closed)current.subtitle=parseSettings(String(raw)).weatherLocation?.label??'지역을 선택하지 않았어요.';}
        catch{if(!closed)current.subtitle='데이터 서비스를 시작한 뒤 다시 열어 주세요.';}
    };
    const choose=async(location:WeatherLocation|null)=>{
        clear.sensitive=false;results.sensitive=false;message.label='지역을 저장하는 중…';
        try{await wire.call(BUS_NAME,'SetWeatherLocation',[JSON.stringify(location)],cancel);if(!closed){message.label=location?'지역을 선택했어요. 날씨 동기화를 기다려 주세요.':'지역을 해제했어요.';empty();}}
        catch{if(!closed)message.label='지역을 저장하지 못했어요. 다시 시도해 주세요.';}
        if(!closed){clear.sensitive=true;results.sensitive=true;await load();}
    };
    const find=async()=>{
        const query=entry.text.trim();if([...query].length<2){message.label='두 글자 이상 입력해 주세요.';return;}
        empty();search.sensitive=false;entry.sensitive=false;message.label='도시를 찾는 중…';
        try{
            const [raw]=await wire.call(BUS_NAME,'SearchLocations',[query],cancel);if(closed)return;
            const locations=parseLocationSearchResults(String(raw));
            for(const location of locations){
                const row=new Adw.ActionRow({title:location.label,subtitle:location.timeZone,title_lines:2});
                const button=new Gtk.Button({label:'선택',valign:Gtk.Align.CENTER});button.connect('clicked',()=>{void choose(location);});row.add_suffix(button);row.activatable_widget=button;results.add(row);rows.push(row);
            }
            results.visible=rows.length>0;message.label=rows.length?'표시할 도시를 선택하세요.':'검색 결과가 없어요.';
        }catch{if(!closed)message.label='검색하지 못했어요. 기존 선택은 유지됩니다. 잠시 후 다시 시도해 주세요.';}
        if(!closed){search.sensitive=true;entry.sensitive=true;}
    };
    search.connect('clicked',()=>{void find();});entry.connect('entry-activated',()=>{void find();});clear.connect('clicked',()=>{void choose(null);});
    const source=new Adw.PreferencesGroup({title:'날씨 데이터',description:'무료 API는 개인 비상업용으로 사용합니다. 데이터: CC BY 4.0.'});page.add(source);
    const attribution=new Adw.ActionRow({title:'출처'});attribution.add_suffix(new Gtk.LinkButton({uri:'https://open-meteo.com/',label:'Open-Meteo',valign:Gtk.Align.CENTER}));attribution.add_suffix(new Gtk.LinkButton({uri:'https://www.geonames.org/',label:'GeoNames',valign:Gtk.Align.CENTER}));source.add(attribution);
    void load();
}
