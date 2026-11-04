import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk?version=4.0';
import Gio from 'gi://Gio';
import {initializeCardColumns,saveCardColumns} from '../cardSettings.js';
import {CARD_IDS,moveCard,transferCard} from '../shared/cards.js';
import type {CardId,CardSide} from '../shared/cards.js';
import type {Message,TextBindings} from '../shared/i18n.js';
import {onPreferencesClosed} from './language.js';

const titles:Record<CardId,Message>={clock:'날짜와 시계',calendar:'월간 달력',weather:'날씨',agenda:'다가오는 일정',network:'네트워크',system:'CPU · 메모리 · 온도',media:'음악'};
type CardControls={row:Adw.ActionRow;toggle:Gtk.Switch;up:Gtk.Button;down:Gtk.Button;transfer:Gtk.Button;updateLabels:()=>void};

export function addCardSettings(window:Adw.PreferencesWindow,page:Adw.PreferencesPage,settings:Gio.Settings,ui:TextBindings):void{
 let columns=initializeCardColumns(settings),updating=false;
 const sides:CardSide[]=['left','right'];
 const lists={} as Record<CardSide,Gtk.ListBox>;
 const rows=new Map<CardId,CardControls>(),ids=new Map<Gtk.ListBoxRow,CardId>();
 const sideFor=(id:CardId):CardSide=>columns.left.includes(id)?'left':'right';
 for(const side of sides){
  const group=ui.bind(new Adw.PreferencesGroup(),{title:side==='left'?'왼쪽 열':'오른쪽 열'});
  if(side==='left')ui.bind(group,{description:'각 열 안에서 순서를 바꾸거나 반대쪽 열로 옮길 수 있습니다. 음악은 재생 중일 때만 표시됩니다.'});
  const list=new Gtk.ListBox({name:`card-columns-${side}`,selection_mode:Gtk.SelectionMode.NONE,css_classes:['boxed-list']});
  list.set_sort_func((left,right)=>columns[side].indexOf(ids.get(left)!)-columns[side].indexOf(ids.get(right)!));
  lists[side]=list;group.add(list);page.add(group);
 }

 for(const id of CARD_IDS){
  const title=titles[id];
  const row=ui.bind(new Adw.ActionRow({name:`card-columns-${id}`}),{title});
  const toggle=ui.bind(new Gtk.Switch({name:`card-columns-${id}-toggle`,valign:Gtk.Align.CENTER}),{tooltip_text:title});
  const up=ui.bind(new Gtk.Button({name:`card-columns-${id}-up`,icon_name:'go-up-symbolic',valign:Gtk.Align.CENTER,css_classes:['flat']}),{tooltip_text:()=>`${ui.t(title)} · ${ui.t('위로 이동')}`});
  const down=ui.bind(new Gtk.Button({name:`card-columns-${id}-down`,icon_name:'go-down-symbolic',valign:Gtk.Align.CENTER,css_classes:['flat']}),{tooltip_text:()=>`${ui.t(title)} · ${ui.t('아래로 이동')}`});
  const transfer=new Gtk.Button({name:`card-columns-${id}-transfer`,valign:Gtk.Align.CENTER,css_classes:['flat']});
  const updateLabels=()=>{
   const side=sideFor(id);
   transfer.icon_name=side==='left'?'go-next-symbolic':'go-previous-symbolic';
   transfer.tooltip_text=`${ui.t(title)} · ${ui.t(side==='left'?'오른쪽 열로 이동':'왼쪽 열로 이동')}`;
   toggle.update_property([Gtk.AccessibleProperty.LABEL],[ui.t(title)]);
   up.update_property([Gtk.AccessibleProperty.LABEL],[up.tooltip_text]);
   down.update_property([Gtk.AccessibleProperty.LABEL],[down.tooltip_text]);
   transfer.update_property([Gtk.AccessibleProperty.LABEL],[transfer.tooltip_text]);
  };
  updateLabels();ui.onChange(updateLabels);
  row.add_suffix(up);row.add_suffix(down);row.add_suffix(transfer);row.add_suffix(toggle);row.activatable_widget=toggle;
  rows.set(id,{row,toggle,up,down,transfer,updateLabels});ids.set(row,id);lists[sideFor(id)].append(row);
  up.connect('clicked',()=>saveCardColumns(settings,moveCard(columns,id,-1)));
  down.connect('clicked',()=>saveCardColumns(settings,moveCard(columns,id,1)));
  transfer.connect('clicked',()=>saveCardColumns(settings,transferCard(columns,id,sideFor(id)==='left'?'right':'left')));
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
   let restoreFocus:Gtk.Widget|null=null;
   // Capture the actual control before reparenting removes its row from the window.
   for(const controls of rows.values()){
    for(const control of [controls.up,controls.down,controls.transfer,controls.toggle]){
     if(focused===control||focused?.is_ancestor(control))restoreFocus=control;
    }
   }
   columns=initializeCardColumns(settings);
   const visible=new Set(settings.get_strv('visible'));
   for(const [id,{row,toggle,up,down,transfer,updateLabels}] of rows){
    const side=sideFor(id),index=columns[side].indexOf(id),list=lists[side];
    const parent=row.get_parent();
    if(parent!==list){
     if(parent instanceof Gtk.ListBox)parent.remove(row);
     list.append(row);
    }
    toggle.active=visible.has(id);up.sensitive=index>0;down.sensitive=index<columns[side].length-1;
    updateLabels();
    // At a boundary keep focus on a usable control in the same card, including one-card columns.
    if(restoreFocus===up&&!up.sensitive)restoreFocus=down.sensitive?down:transfer;
    else if(restoreFocus===down&&!down.sensitive)restoreFocus=up.sensitive?up:transfer;
   }
   for(const side of sides)lists[side].invalidate_sort();
   restoreFocus?.grab_focus();
  }finally{updating=false;}
 };
 refresh();
 const columnsChanged=settings.connect('changed::card-columns',refresh);
 const visibleChanged=settings.connect('changed::visible',refresh);
 onPreferencesClosed(window,()=>{settings.disconnect(columnsChanged);settings.disconnect(visibleChanged);});
}
