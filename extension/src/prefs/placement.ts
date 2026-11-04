import {onPreferencesClosed} from './language.js';
import Adw from 'gi://Adw';import Gtk from 'gi://Gtk?version=4.0';import Gdk from 'gi://Gdk?version=4.0';import Gio from 'gi://Gio';
import {SessionTransport,BUS_NAME} from '../dbus.js';import {Cancellation} from '../shared/dataClient.js';import {parseSettings} from '../shared/validation.js';
import type {TextBindings} from '../shared/i18n.js';
export function addDisplaySettings(window:Adw.PreferencesWindow,page:Adw.PreferencesPage,settings:Gio.Settings,ui:TextBindings):void{
 const group=ui.bind(new Adw.PreferencesGroup(),{title:'화면과 위치',description:'선택한 화면이 없으면 주 모니터에 표시합니다. 여백은 작업 영역에 맞게 제한됩니다.'});page.add(group);
 const monitor=ui.bind(new Adw.ComboRow(),{title:'모니터'});group.add(monitor);let ids:string[]=[],updating=false;
 const monitors=Gdk.Display.get_default()?.get_monitors();
 const refresh=()=>{
  updating=true;ids=['primary'];const labels=[ui.t('주 모니터 (자동)')];
  if(monitors)for(let i=0;i<monitors.get_n_items();i++){const item=monitors.get_item(i) as Gdk.Monitor;const connector=item.get_connector();if(connector&&!ids.includes(connector)){ids.push(connector);labels.push(`${connector} · ${item.get_model()??ui.t('모니터')}`);}}
  const current=settings.get_string('monitor');if(!ids.includes(current)){ids.push(current);labels.push(ui.t('{monitor} · 연결 안 됨 (주 모니터에 표시)',{monitor:current}));}
  monitor.model=Gtk.StringList.new(labels);monitor.selected=ids.indexOf(current);updating=false;
 };
 refresh();ui.onChange(refresh);
 monitor.connect('notify::selected',()=>{const id=ids[monitor.selected];if(!updating&&id)settings.set_string('monitor',id);});
 const changed=monitors?.connect('items-changed',refresh);onPreferencesClosed(window,()=>{if(changed)monitors?.disconnect(changed);});
 const anchors=['top-right','top-left'];let updatingAnchor=false;
 const anchor=ui.bind(new Adw.ComboRow(),{title:'기준 위치'});
 const refreshAnchor=()=>{updatingAnchor=true;anchor.model=Gtk.StringList.new([ui.t('오른쪽 위'),ui.t('왼쪽 위')]);anchor.selected=Math.max(0,anchors.indexOf(settings.get_string('anchor')));updatingAnchor=false;};
 refreshAnchor();ui.onChange(refreshAnchor);
 anchor.connect('notify::selected',()=>{const value=anchors[anchor.selected];if(!updatingAnchor&&value)settings.set_string('anchor',value);});group.add(anchor);
 for(const [key,title] of [['offset-x','가로 여백'],['offset-y','세로 여백']] as const){const row=ui.bind(new Adw.SpinRow({adjustment:new Gtk.Adjustment({lower:0,upper:1000,step_increment:1,page_increment:10}),digits:0}),{title,subtitle:'논리 픽셀'});settings.bind(key,row,'value',Gio.SettingsBindFlags.DEFAULT);group.add(row);}
}
function interfaces():string[]{
 const names:string[]=[];try{const files=Gio.File.new_for_path('/sys/class/net').enumerate_children('standard::name',Gio.FileQueryInfoFlags.NONE,null);try{let info;while((info=files.next_file(null)))names.push(info.get_name());}finally{files.close(null);}}catch{}
 return names.sort();
}
export function addNetworkSettings(window:Adw.PreferencesWindow,page:Adw.PreferencesPage,ui:TextBindings):void{
 const wire=new SessionTransport(),cancel=new Cancellation();let closed=false;onPreferencesClosed(window,()=>{closed=true;cancel.cancel();});
 const group=ui.bind(new Adw.PreferencesGroup(),{title:'네트워크',description:'자동은 기본 경로의 물리 인터페이스 하나를 사용합니다. Tailscale 트래픽은 tailscale0을 직접 선택하세요.'});page.add(group);
 const row=ui.bind(new Adw.ComboRow({sensitive:false}),{title:'네트워크 인터페이스'});group.add(row);
 const action=ui.bind(new Adw.ActionRow(),{title:'인터페이스 적용'});const save=ui.bind(new Gtk.Button({valign:Gtk.Align.CENTER,sensitive:false}),{label:'저장'});action.add_suffix(save);group.add(action);
 const notice=ui.bind(new Gtk.Label({wrap:true,xalign:0,margin_top:8,margin_bottom:8}),{label:'현재 설정을 확인하는 중…'});group.add(notice);let values:string[]=[];
 const renderChoices=(value=values[row.selected])=>{row.model=Gtk.StringList.new(values.map(id=>id==='auto'?ui.t('자동 (기본 경로)'):id));row.selected=Math.max(0,values.indexOf(value??'auto'));};
 ui.onChange(()=>renderChoices());
 const load=async()=>{
  try{const [raw]=await wire.call(BUS_NAME,'GetSettings',[],cancel);if(closed)return;const value=parseSettings(String(raw)).networkInterface;
   values=['auto',...interfaces()];if(!values.includes(value))values.push(value);renderChoices(value);row.sensitive=true;save.sensitive=true;
   ui.bind(notice,{label:()=>ui.t('사용 중: {value}',{value:value==='auto'?ui.t('자동'):value})});
  }catch{if(!closed)ui.bind(notice,{label:'데이터 서비스를 시작한 뒤 다시 열어 주세요.'});}
 };
 save.connect('clicked',()=>{void(async()=>{
  const value=values[row.selected];if(!value)return;row.sensitive=false;save.sensitive=false;ui.bind(notice,{label:'저장하는 중…'});
  try{await wire.call(BUS_NAME,'SetNetworkInterface',[value],cancel);if(!closed)ui.bind(notice,{label:'저장했어요. 새 인터페이스의 첫 속도를 측정합니다.'});}
  catch{if(!closed)ui.bind(notice,{label:'저장하지 못했어요. 다시 시도해 주세요.'});}
  if(!closed){row.sensitive=true;save.sensitive=true;}
 })();});void load();
}
