import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk?version=4.0';
import Gio from 'gi://Gio';
import type {TextBindings} from '../shared/i18n.js';
import {onPreferencesClosed} from './language.js';

const styles=['digital','square','classic','minimal'];
const labels=['큰 디지털','사각 눈금','클래식 원형','미니멀 아날로그'] as const;

export function addClockSettings(window:Adw.PreferencesWindow,page:Adw.PreferencesPage,settings:Gio.Settings,ui:TextBindings):void{
 const group=ui.bind(new Adw.PreferencesGroup(),{title:'시계'});
 const row=ui.bind(new Adw.ComboRow({name:'clock-style'}),{title:'시계 스타일',subtitle:'선택한 스타일이 바로 적용됩니다.'});
 let updating=false;
 const refresh=(translate=false)=>{
  updating=true;
  try{
   if(translate)row.model=Gtk.StringList.new(labels.map(label=>ui.t(label)));
   row.selected=Math.max(0,styles.indexOf(settings.get_string('clock-style')));
  }finally{updating=false;}
 };
 refresh(true);ui.onChange(()=>refresh(true));
 const selectionChanged=row.connect('notify::selected',()=>{
  const value=styles[row.selected];
  if(!updating&&value&&value!==settings.get_string('clock-style'))settings.set_string('clock-style',value);
 });
 const styleChanged=settings.connect('changed::clock-style',()=>refresh());
 onPreferencesClosed(window,()=>{settings.disconnect(styleChanged);row.disconnect(selectionChanged);});
 group.add(row);page.add(group);
}
