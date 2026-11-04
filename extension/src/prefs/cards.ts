import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk?version=4.0';
import Gio from 'gi://Gio';
import {initializeCardOrder} from '../cardSettings.js';
import {CARD_IDS,moveCard} from '../shared/cards.js';
import type {CardId} from '../shared/cards.js';
import type {Message,TextBindings} from '../shared/i18n.js';
import {onPreferencesClosed} from './language.js';

const titles:Record<CardId,Message>={clock:'날짜와 시계',calendar:'월간 달력',weather:'날씨',agenda:'다가오는 일정',network:'네트워크',system:'CPU · 메모리 · 온도',media:'음악'};
type CardControls={row:Adw.ActionRow;toggle:Gtk.Switch;up:Gtk.Button;down:Gtk.Button};

export function addCardSettings(window:Adw.PreferencesWindow,page:Adw.PreferencesPage,settings:Gio.Settings,ui:TextBindings):void{
 let order=initializeCardOrder(settings),updating=false;
 const group=ui.bind(new Adw.PreferencesGroup(),{title:'표시할 카드',description:'위·아래 버튼으로 순서를 바꿉니다. 카드는 왼쪽부터 한 줄에 두 개씩 배치됩니다. 음악은 재생 중일 때만 표시됩니다.'});
 const list=new Gtk.ListBox({name:'card-order-list',selection_mode:Gtk.SelectionMode.NONE,css_classes:['boxed-list']});
 const rows=new Map<CardId,CardControls>(),ids=new Map<Gtk.ListBoxRow,CardId>();
 list.set_sort_func((left,right)=>order.indexOf(ids.get(left)!)-order.indexOf(ids.get(right)!));
 group.add(list);page.add(group);

 for(const id of CARD_IDS){
  const title=titles[id];
  const row=ui.bind(new Adw.ActionRow({name:`card-order-${id}`}),{title});
  const toggle=ui.bind(new Gtk.Switch({name:`card-order-${id}-toggle`,valign:Gtk.Align.CENTER}),{tooltip_text:title});
  const up=ui.bind(new Gtk.Button({name:`card-order-${id}-up`,icon_name:'go-up-symbolic',valign:Gtk.Align.CENTER,css_classes:['flat']}),{tooltip_text:()=>`${ui.t(title)} · ${ui.t('위로 이동')}`});
  const down=ui.bind(new Gtk.Button({name:`card-order-${id}-down`,icon_name:'go-down-symbolic',valign:Gtk.Align.CENTER,css_classes:['flat']}),{tooltip_text:()=>`${ui.t(title)} · ${ui.t('아래로 이동')}`});
  const accessibleNames=()=>{
   toggle.update_property([Gtk.AccessibleProperty.LABEL],[ui.t(title)]);
   up.update_property([Gtk.AccessibleProperty.LABEL],[up.tooltip_text]);
   down.update_property([Gtk.AccessibleProperty.LABEL],[down.tooltip_text]);
  };
  accessibleNames();ui.onChange(accessibleNames);
  row.add_suffix(up);row.add_suffix(down);row.add_suffix(toggle);row.activatable_widget=toggle;
  rows.set(id,{row,toggle,up,down});ids.set(row,id);list.append(row);
  up.connect('clicked',()=>settings.set_strv('card-order',moveCard(order,id,-1)));
  down.connect('clicked',()=>settings.set_strv('card-order',moveCard(order,id,1)));
  toggle.connect('notify::active',()=>{
   if(updating)return;
   const visible=settings.get_strv('visible').filter(value=>value!==id);
   if(toggle.active)visible.push(id);
   settings.set_strv('visible',visible);
  });
 }

 const refresh=()=>{
  if(updating)return;
  updating=true;
  try{
   const focused=window.get_focus();
   order=initializeCardOrder(settings);
   const visible=new Set(settings.get_strv('visible'));
   for(const [id,{toggle,up,down}] of rows){
    const index=order.indexOf(id);
    toggle.active=visible.has(id);up.sensitive=index>0;down.sensitive=index<order.length-1;
    // Keep keyboard interaction on the moved row when its boundary button becomes disabled.
    if(focused===up&&!up.sensitive)down.grab_focus();
    else if(focused===down&&!down.sensitive)up.grab_focus();
   }
   list.invalidate_sort();
  }finally{updating=false;}
 };
 refresh();
 const orderChanged=settings.connect('changed::card-order',refresh);
 const visibleChanged=settings.connect('changed::visible',refresh);
 onPreferencesClosed(window,()=>{settings.disconnect(orderChanged);settings.disconnect(visibleChanged);});
}
