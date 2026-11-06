import {onPreferencesClosed} from './language.js';
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk?version=4.0';
import {Cancellation} from '../shared/dataClient.js';
import type {PreferencesDataSession} from '../backend/contracts.js';
import type {CalendarSummary,CalendarOrigin} from '../shared/calendarSummary.js';
import {calendarSummaryStatus} from '../shared/calendarStatus.js';
import type {TextBindings} from '../shared/i18n.js';
import type {Settings} from '../types.js';
export function addCalendarSettings(window:Adw.PreferencesWindow,page:Adw.PreferencesPage,ui:TextBindings,session:PreferencesDataSession):void{
 const cancel=new Cancellation();let closed=false,loaded:Settings|null=null,loadFailed=false,summary:CalendarSummary|null=null,origin:CalendarOrigin='unavailable';
 const subtitle=()=>loadFailed?ui.t('설정을 읽지 못했어요. 잠시 후 다시 시도해 주세요.'):loaded?calendarSummaryStatus(loaded,summary,origin,ui.language):ui.t('확인 중…');
 const title=()=>ui.t(origin==='preview'?'설정창 연결 확인':'위젯 동기화');
 const render=()=>{if(!closed)ui.bind(status,{title,subtitle});};
 let stopWatch=()=>{};onPreferencesClosed(window,()=>{closed=true;cancel.cancel();stopWatch();});
 const group=ui.bind(new Adw.PreferencesGroup(),{title:'Google Calendar',description:'읽기 전용으로 연결합니다. Google Calendar 설정 → 캘린더 통합 → iCal 형식의 비공개 주소를 입력하세요.'});page.add(group);
 const status=ui.bind(new Adw.ActionRow(),{title,subtitle});group.add(status);
 const entry=ui.bind(new Adw.PasswordEntryRow(),{title:'비공개 iCal 주소'});group.add(entry);
 const controls=ui.bind(new Adw.ActionRow(),{title:'캘린더 연결 관리'});
 const connect=ui.bind(new Gtk.Button({valign:Gtk.Align.CENTER,css_classes:['suggested-action']}),{label:'연결'});
 const clear=ui.bind(new Gtk.Button({valign:Gtk.Align.CENTER}),{label:'연결 해제'});controls.add_suffix(clear);controls.add_suffix(connect);group.add(controls);
 const notice=ui.bind(new Gtk.Label({wrap:true,xalign:0,margin_top:8,margin_bottom:8}),{label:'주소는 저장 후 다시 표시하지 않습니다.'});group.add(notice);
 const load=async()=>{
  try{
   const settings=await session.getSettings(cancel);if(closed)return;
   loaded=settings;loadFailed=false;render();
   ui.bind(clear,{label:loaded.calendarSecretDeletionPending?'연결 정보 삭제':'연결 해제'});
  }catch{if(!closed){loadFailed=true;render();}}
 };
 const act=async(method:string,args:string[])=>{
  connect.sensitive=false;clear.sensitive=false;entry.sensitive=false;ui.bind(notice,{label:'처리 중…'});
  try{
   if(method==='SetCalendarSecret')await session.setCalendarSecret(args[0]!,cancel);else await session.clearCalendarSecret(cancel);if(closed)return;
   ui.bind(notice,{label:method==='SetCalendarSecret'?'연결 정보를 저장했어요. 동기화 결과는 위 연결 상태에 표시됩니다.':'일정과 연결 정보를 삭제했어요.'});
  }catch{if(!closed)ui.bind(notice,{label:'처리하지 못했어요. 주소 형식과 키링 잠금을 확인해 주세요.'});}
  if(!closed){connect.sensitive=true;clear.sensitive=true;entry.sensitive=true;await load();}
 };
 connect.connect('clicked',()=>{const url=entry.text;entry.text='';void act('SetCalendarSecret',[url]);});
 clear.connect('clicked',()=>{entry.text='';void act('ClearCalendarSecret',[]);});
 let source:string|null|undefined;stopWatch=session.watchCalendar((state,nextOrigin)=>{summary=state;origin=nextOrigin;if(source!==state.sourceId){source=state.sourceId;void load();}render();});void load();
}
