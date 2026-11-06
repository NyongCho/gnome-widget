import {onPreferencesClosed} from './language.js';
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk?version=4.0';
import type {PreferencesDataSession} from '../backend/contracts.js';
import {Cancellation} from '../shared/dataClient.js';
import type {WeatherLocation} from '../types.js';
import type {TextBindings} from '../shared/i18n.js';
export function addWeatherSettings(window:Adw.PreferencesWindow,page:Adw.PreferencesPage,ui:TextBindings,session:PreferencesDataSession):void{
 const cancel=new Cancellation();let closed=false;
 onPreferencesClosed(window,()=>{closed=true;cancel.cancel();});
 const group=ui.bind(new Adw.PreferencesGroup(),{title:'날씨 지역',description:'선택한 도시의 현재 날씨와 앞으로 6시간 예보를 표시합니다.'});page.add(group);
 const current=ui.bind(new Adw.ActionRow(),{title:'선택한 지역',subtitle:'확인 중…'});group.add(current);
 const clear=ui.bind(new Gtk.Button({valign:Gtk.Align.CENTER}),{label:'해제'});current.add_suffix(clear);
 const entry=ui.bind(new Adw.EntryRow(),{title:'도시 이름'});const search=ui.bind(new Gtk.Button({valign:Gtk.Align.CENTER}),{label:'검색'});entry.add_suffix(search);group.add(entry);
 const message=ui.bind(new Gtk.Label({wrap:true,xalign:0,margin_top:8,margin_bottom:8}),{label:'두 글자 이상 입력해 검색하세요.'});group.add(message);
 const results=ui.bind(new Adw.PreferencesGroup({visible:false}),{title:'검색 결과'});page.add(results);
 let rows:{row:Adw.ActionRow;button:Gtk.Button}[]=[];
 const empty=()=>{for(const {row,button} of rows){ui.unbind(button);results.remove(row);}rows=[];results.visible=false;};
 const load=async()=>{
  try{const settings=await session.getSettings(cancel);if(closed)return;const location=settings.weatherLocation;ui.bind(current,{subtitle:()=>location?.label??ui.t('지역을 선택하지 않았어요.')});}
  catch{if(!closed)ui.bind(current,{subtitle:'설정을 읽지 못했어요. 잠시 후 다시 시도해 주세요.'});}
 };
 const choose=async(location:WeatherLocation|null)=>{
  clear.sensitive=false;results.sensitive=false;ui.bind(message,{label:'지역을 저장하는 중…'});
  try{await session.setWeatherLocation(location,cancel);if(!closed){ui.bind(message,{label:location?'지역을 선택했어요. 날씨 동기화를 기다려 주세요.':'지역을 해제했어요.'});empty();}}
  catch{if(!closed)ui.bind(message,{label:'지역을 저장하지 못했어요. 다시 시도해 주세요.'});}
  if(!closed){clear.sensitive=true;results.sensitive=true;await load();}
 };
 const find=async()=>{
  const query=entry.text.trim();if([...query].length<2){ui.bind(message,{label:'두 글자 이상 입력해 주세요.'});return;}
  empty();search.sensitive=false;entry.sensitive=false;ui.bind(message,{label:'도시를 찾는 중…'});
  try{
   const locations=await session.searchLocations(query,cancel);if(closed)return;
   for(const location of locations){
    const row=new Adw.ActionRow({title:location.label,subtitle:location.timeZone,title_lines:2});
    const button=ui.bind(new Gtk.Button({valign:Gtk.Align.CENTER}),{label:'선택'});button.connect('clicked',()=>{void choose(location);});row.add_suffix(button);row.activatable_widget=button;results.add(row);rows.push({row,button});
   }
   results.visible=rows.length>0;ui.bind(message,{label:rows.length?'표시할 도시를 선택하세요.':'검색 결과가 없어요.'});
  }catch{if(!closed)ui.bind(message,{label:'검색하지 못했어요. 기존 선택은 유지됩니다. 잠시 후 다시 시도해 주세요.'});}
  if(!closed){search.sensitive=true;entry.sensitive=true;}
 };
 search.connect('clicked',()=>{void find();});entry.connect('entry-activated',()=>{void find();});clear.connect('clicked',()=>{void choose(null);});
 const source=ui.bind(new Adw.PreferencesGroup(),{title:'날씨 데이터',description:'무료 API는 개인 비상업용으로 사용합니다. 데이터: CC BY 4.0.'});page.add(source);
 const attribution=ui.bind(new Adw.ActionRow(),{title:'출처'});attribution.add_suffix(new Gtk.LinkButton({uri:'https://open-meteo.com/',label:'Open-Meteo',valign:Gtk.Align.CENTER}));attribution.add_suffix(new Gtk.LinkButton({uri:'https://www.geonames.org/',label:'GeoNames',valign:Gtk.Align.CENTER}));source.add(attribution);
 void load();
}
