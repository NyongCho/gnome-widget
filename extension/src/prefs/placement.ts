import Adw from 'gi://Adw';import Gtk from 'gi://Gtk?version=4.0';import Gdk from 'gi://Gdk?version=4.0';import Gio from 'gi://Gio';
import {SessionTransport,BUS_NAME} from '../dbus.js';import {Cancellation} from '../shared/dataClient.js';import {parseSettings} from '../shared/validation.js';
export function addDisplaySettings(window:Adw.PreferencesWindow,page:Adw.PreferencesPage,settings:Gio.Settings):void{
 const group=new Adw.PreferencesGroup({title:'화면과 위치',description:'선택한 화면이 없으면 주 모니터에 표시합니다. 여백은 작업 영역에 맞게 제한됩니다.'});page.add(group);
 const monitor=new Adw.ComboRow({title:'모니터'});group.add(monitor);let ids:string[]=[],updating=false;
 const monitors=Gdk.Display.get_default()?.get_monitors();
 const refresh=()=>{
  updating=true;ids=['primary'];const labels=['주 모니터 (자동)'];
  if(monitors)for(let i=0;i<monitors.get_n_items();i++){const item=monitors.get_item(i) as Gdk.Monitor;const connector=item.get_connector();if(connector&&!ids.includes(connector)){ids.push(connector);labels.push(`${connector} · ${item.get_model()??'모니터'}`);}}
  const current=settings.get_string('monitor');if(!ids.includes(current)){ids.push(current);labels.push(`${current} · 연결 안 됨 (주 모니터에 표시)`);}
  monitor.model=Gtk.StringList.new(labels);monitor.selected=ids.indexOf(current);updating=false;
 };
 refresh();monitor.connect('notify::selected',()=>{const id=ids[monitor.selected];if(!updating&&id)settings.set_string('monitor',id);});
 const changed=monitors?.connect('items-changed',refresh);window.connect('destroy',()=>{if(changed)monitors?.disconnect(changed);});
 const anchors=['top-right','top-left'];const anchor=new Adw.ComboRow({title:'기준 위치',model:Gtk.StringList.new(['오른쪽 위','왼쪽 위']),selected:Math.max(0,anchors.indexOf(settings.get_string('anchor')))});
 anchor.connect('notify::selected',()=>{const value=anchors[anchor.selected];if(value)settings.set_string('anchor',value);});group.add(anchor);
 for(const [key,title] of [['offset-x','가로 여백'],['offset-y','세로 여백']] as const){const row=new Adw.SpinRow({title,subtitle:'논리 픽셀',adjustment:new Gtk.Adjustment({lower:0,upper:1000,step_increment:1,page_increment:10}),digits:0});settings.bind(key,row,'value',Gio.SettingsBindFlags.DEFAULT);group.add(row);}
}
function interfaces():string[]{
 const names:string[]=[];try{const files=Gio.File.new_for_path('/sys/class/net').enumerate_children('standard::name',Gio.FileQueryInfoFlags.NONE,null);try{let info;while((info=files.next_file(null)))names.push(info.get_name());}finally{files.close(null);}}catch{}
 return names.sort();
}
export function addNetworkSettings(window:Adw.PreferencesWindow,page:Adw.PreferencesPage):void{
 const wire=new SessionTransport(),cancel=new Cancellation();let closed=false;window.connect('destroy',()=>{closed=true;cancel.cancel();});
 const group=new Adw.PreferencesGroup({title:'네트워크',description:'자동은 기본 경로의 물리 인터페이스 하나를 사용합니다. Tailscale 트래픽은 tailscale0을 직접 선택하세요.'});page.add(group);
 const row=new Adw.ComboRow({title:'네트워크 인터페이스',sensitive:false});group.add(row);
 const action=new Adw.ActionRow({title:'인터페이스 적용'});const save=new Gtk.Button({label:'저장',valign:Gtk.Align.CENTER,sensitive:false});action.add_suffix(save);group.add(action);
 const notice=new Gtk.Label({label:'현재 설정을 확인하는 중…',wrap:true,xalign:0,margin_top:8,margin_bottom:8});group.add(notice);let values:string[]=[];
 const load=async()=>{
  try{const [raw]=await wire.call(BUS_NAME,'GetSettings',[],cancel);if(closed)return;const value=parseSettings(String(raw)).networkInterface;
   values=['auto',...interfaces()];if(!values.includes(value))values.push(value);row.model=Gtk.StringList.new(values.map(id=>id==='auto'?'자동 (기본 경로)':id));row.selected=values.indexOf(value);row.sensitive=true;save.sensitive=true;notice.label=`사용 중: ${value==='auto'?'자동':value}`;
  }catch{if(!closed)notice.label='데이터 서비스를 시작한 뒤 다시 열어 주세요.';}
 };
 save.connect('clicked',()=>{void(async()=>{
  const value=values[row.selected];if(!value)return;row.sensitive=false;save.sensitive=false;notice.label='저장하는 중…';
  try{await wire.call(BUS_NAME,'SetNetworkInterface',[value],cancel);if(!closed)notice.label='저장했어요. 새 인터페이스의 첫 속도를 측정합니다.';}
  catch{if(!closed)notice.label='저장하지 못했어요. 다시 시도해 주세요.';}
  if(!closed){row.sensitive=true;save.sensitive=true;}
 })();});void load();
}
