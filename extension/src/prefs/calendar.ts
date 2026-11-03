import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk?version=4.0';
import {SessionTransport,BUS_NAME} from '../dbus.js';
import {Cancellation} from '../shared/dataClient.js';
import {parseSettings} from '../shared/validation.js';
export function addCalendarSettings(window:Adw.PreferencesWindow,page:Adw.PreferencesPage):void{
    const wire=new SessionTransport(),cancel=new Cancellation();let closed=false;
    window.connect('destroy',()=>{closed=true;cancel.cancel();});
    const group=new Adw.PreferencesGroup({title:'Google Calendar',description:'읽기 전용으로 연결합니다. Google Calendar 설정 → 캘린더 통합 → iCal 형식의 비공개 주소를 입력하세요.'});page.add(group);
    const status=new Adw.ActionRow({title:'연결 상태',subtitle:'확인 중…'});group.add(status);
    const entry=new Adw.PasswordEntryRow({title:'비공개 iCal 주소'});group.add(entry);
    const controls=new Adw.ActionRow({title:'캘린더 연결 관리'});
    const connect=new Gtk.Button({label:'연결',valign:Gtk.Align.CENTER,css_classes:['suggested-action']});
    const clear=new Gtk.Button({label:'연결 해제',valign:Gtk.Align.CENTER});controls.add_suffix(clear);controls.add_suffix(connect);group.add(controls);
    const notice=new Gtk.Label({label:'주소는 저장 후 다시 표시하지 않습니다.',wrap:true,xalign:0,margin_top:8,margin_bottom:8});group.add(notice);
    const load=async()=>{
        try{
            const [raw]=await wire.call(BUS_NAME,'GetSettings',[],cancel);if(closed)return;
            const settings=parseSettings(String(raw));
            status.subtitle=settings.calendarSecretDeletionPending?'연결 정보 삭제가 남아 있어요. 키링을 해제하고 다시 삭제해 주세요.':settings.calendarEnabled?'연결됨 · 카드를 클릭하면 브라우저에서 열립니다.':'연결하지 않음';
            clear.label=settings.calendarSecretDeletionPending?'연결 정보 삭제':'연결 해제';
        }catch{if(!closed)status.subtitle='데이터 서비스를 시작한 뒤 다시 열어 주세요.';}
    };
    const act=async(method:string,args:string[])=>{
        connect.sensitive=false;clear.sensitive=false;entry.sensitive=false;notice.label='처리 중…';
        try{
            await wire.call(BUS_NAME,method,args,cancel);if(closed)return;
            notice.label=method==='SetCalendarSecret'?'연결했어요. 일정 동기화를 기다려 주세요.':'일정과 연결 정보를 삭제했어요.';
        }catch{if(!closed)notice.label='처리하지 못했어요. 주소 형식과 키링 잠금을 확인해 주세요.';}
        if(!closed){connect.sensitive=true;clear.sensitive=true;entry.sensitive=true;await load();}
    };
    connect.connect('clicked',()=>{const url=entry.text;entry.text='';void act('SetCalendarSecret',[url]);});
    clear.connect('clicked',()=>{entry.text='';void act('ClearCalendarSecret',[]);});
    void load();
}
