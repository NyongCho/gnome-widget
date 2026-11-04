import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Pango from 'gi://Pango';
import type {ProviderName,ProviderMap,Snapshot,ProviderState,CalendarData} from '../types.js';
import {translate,language,localeFor,type Message} from '../shared/i18n.js';
import {GlassCard,label,clockLabel,fitClockLabel} from './card.js';
import {renderNetwork,renderMedia} from './live.js';
import {renderSystem} from './system.js';
import {renderWeather} from './weather.js';
import {cardState} from '../shared/cardState.js';
import {clockValues} from '../shared/clockValues.js';
import {monthGrid,eventDays} from '../shared/calendarFormat.js';
import {selectAgenda,formatAgendaWhen} from '../shared/agenda.js';
import {computeLayout,type LayoutConfig,type LayoutResult} from '../shared/layout.js';
const TITLES:Record<string,Message>={clock:'오늘',calendar:'달력',weather:'날씨',agenda:'다가오는 일정',network:'네트워크',system:'시스템',media:'지금 재생 중'};
export class WidgetHost {
    readonly actor=new St.Widget({name:'liquid-widgets-host',style_class:'liquid-widgets'});
    private scheme=St.Settings.get();
    private schemeSignal:number;
    private get dark():boolean{return this.scheme.color_scheme===St.SystemColorScheme.PREFER_DARK;}
    private toolbar=new St.BoxLayout({style_class:'liquid-toolbar'});
    private scroll=new St.ScrollView({overlay_scrollbars:true,reactive:false});
    private content=new St.BoxLayout({orientation:Clutter.Orientation.VERTICAL});
    private canvas=new St.Widget({layout_manager:new Clutter.FixedLayout()});
    private cards=new Map<string,GlassCard>();
    private current:LayoutResult|null=null;
    private config:LayoutConfig|null=null;
    private area:{x:number;y:number;width:number;height:number}|null=null;
    private monitor=-1;
    private scale=1;
    private connected=false;
    private states=new Map<ProviderName,ProviderState<unknown>>();
    private adjustmentSignal:number;
    private now=Date.now();private zone='UTC';private hour12=false;private weekStart=1;
    private settingsButton:St.Button;
    private get language(){return language(this.settings.get_string('language'));}
    private get locale():string{return localeFor(this.language);}
    private t(message:Message,values?:Readonly<Record<string,string|number>>):string{return translate(this.language,message,values);}
    constructor(private settings:Gio.Settings,private preferences:()=>void){
        const name=label('LIQUID','liquid-brand');name.clutter_text.ellipsize=Pango.EllipsizeMode.NONE;name.x_expand=false;name.y_align=Clutter.ActorAlign.CENTER;this.toolbar.add_child(name);
        this.toolbar.add_child(new St.Widget({x_expand:true}));
        this.settingsButton=new St.Button({child:new St.Icon({icon_name:'emblem-system-symbolic',icon_size:15}),style_class:'liquid-settings',y_align:Clutter.ActorAlign.CENTER,can_focus:true,reactive:true,accessible_name:this.t('위젯 설정')});
        this.settingsButton.connect('clicked',preferences);this.toolbar.add_child(this.settingsButton);
        this.actor.add_child(this.toolbar);this.actor.add_child(this.scroll);
        this.content.add_child(this.canvas);this.scroll.set_child(this.content);
        this.scroll.set_policy(St.PolicyType.NEVER,St.PolicyType.AUTOMATIC);
        this.adjustmentSignal=this.scroll.vadjustment.connect('notify::value',()=>this.placeCards());
        this.schemeSignal=this.scheme.connect('notify::color-scheme',()=>this.refreshAppearance());
        this.refreshAppearance();
    }
    private refreshAppearance():void{
        this.actor.set_style_class_name(`liquid-widgets ${this.dark?'liquid-dark':'liquid-light'}`);
        this.placeCards();this.renderAll();this.reflow();
    }
    get visibleCards():string[]{
        return this.settings.get_strv('visible').filter(id=>id!=='media'||(this.states.get('media')?.data as ProviderMap['media']['data'])?.status==='playing');
    }
    layout(config:LayoutConfig,area:{x:number;y:number;width:number;height:number},monitor:number):void{
        this.config=config;this.area={...area};this.scale=config.scale;
        if(this.monitor!==monitor){for(const card of this.cards.values())card.destroy();this.cards.clear();this.monitor=monitor;}
        const wanted=this.visibleCards;
        for(const [id,card] of this.cards)if(!wanted.includes(id)){card.destroy();this.cards.delete(id);}
        for(const id of wanted)if(!this.cards.has(id)){
            const card=new GlassCard(id,monitor,TITLES[id]?this.t(TITLES[id]):id,()=>{
                if(id==='calendar'||id==='agenda')Gio.AppInfo.launch_default_for_uri_async('https://calendar.google.com/',null,null,(_object,result)=>{try{Gio.AppInfo.launch_default_for_uri_finish(result);}catch{card.status.set_text(this.t('브라우저를 열 수 없어요'));this.reflow();}});
                else this.preferences();
            });
            this.cards.set(id,card);this.canvas.add_child(card.surface.actor);
            card.button.connect('key-focus-in',()=>this.reveal(id));
        }
        // Establish width and typography before measuring; never apply a
        // temporary fixed height to the glass, which would discard its cache.
        for(const {id,rect} of computeLayout(config,area,wanted).cards){
            const card=this.cards.get(id)!;card.button.set_width(rect.width);
            card.setStyle(this.settings.get_double('strength'),this.settings.get_double('opacity'),this.settings.get_boolean('low-power'),this.dark,this.scale);
        }
        this.renderAll();this.reflow();
    }
    private reflow():void{
        if(!this.config||!this.area)return;
        const wanted=this.visibleCards.filter(id=>this.cards.has(id));
        const measured=Object.fromEntries(wanted.map(id=>{
            const card=this.cards.get(id)!;
            return[id,Math.ceil(card.content.get_preferred_height(card.button.width)[1])];
        }));
        this.current=computeLayout(this.config,this.area,wanted,measured);
        const {viewport,toolbarHeight,contentHeight}=this.current;
        this.actor.set_position(viewport.x,viewport.y);this.actor.set_size(viewport.width,viewport.height);
        this.toolbar.set_size(viewport.width,toolbarHeight-8);
        this.scroll.set_position(0,toolbarHeight);this.scroll.set_size(viewport.width,viewport.height-toolbarHeight);
        this.canvas.set_size(viewport.width,contentHeight);
        this.placeCards();
    }
    private reveal(id:string):void{
        const item=this.current?.cards.find(c=>c.id===id);if(!item||!this.current)return;
        const adjustment=this.scroll.vadjustment;const visible=this.current.viewport.height-this.current.toolbarHeight;
        if(item.rect.y<adjustment.value)adjustment.value=item.rect.y;
        else if(item.rect.y+item.rect.height>adjustment.value+visible)adjustment.value=item.rect.y+item.rect.height-visible;
    }
    private placeCards():void{
        if(!this.current)return;const {viewport,toolbarHeight}=this.current;
        for(const {id,rect} of this.current.cards){
            const card=this.cards.get(id)!;
            card.setGeometry(rect,{...rect,x:viewport.x+rect.x,y:viewport.y+toolbarHeight+rect.y-this.scroll.vadjustment.value},this.scale);
            card.setStyle(this.settings.get_double('strength'),this.settings.get_double('opacity'),this.settings.get_boolean('low-power'),this.dark);
        }
    }
    update(snapshot:Snapshot):void{for(const name of ['calendar','weather','system','network','media'] as const)this.updateProvider(name,snapshot[name]);}
    updateProvider<K extends ProviderName>(name:K,state:ProviderMap[K]):void{
        this.states.set(name,state);for(const id of name==='calendar'?['calendar','agenda']:[name])this.render(id);
        this.reflow();
    }
    setConnected(value:boolean):void{this.connected=value;this.renderAll();this.reflow();}
    tick(now:number,zone:string,hour12:boolean,_systemLocale:string,weekStart:number):void{
        this.now=now;this.zone=zone;this.hour12=hour12;this.weekStart=weekStart;
        for(const id of ['clock','calendar','agenda'])this.render(id);
        this.reflow();
    }
    private renderAll():void{this.settingsButton.accessible_name=this.t('위젯 설정');for(const id of this.cards.keys())this.render(id);}
    private render(id:string):void{
        const card=this.cards.get(id);if(!card)return;card.clear();card.title.set_text(TITLES[id]?this.t(TITLES[id]):id);card.button.accessible_name=TITLES[id]?this.t(TITLES[id]):id;card.mode.set_text(this.t('굴절 불가 · 반투명'));
        const clock=clockValues(this.now,this.zone,this.hour12,this.locale);
        if(id==='clock'){
            card.title.set_text(`${clock.weekday} · ${clock.date}`);
            const time=clockLabel(clock.time);card.body.add_child(time);fitClockLabel(time,card.button.width-36*this.scale);card.status.set_text('');return;
        }
        const provider=(id==='agenda'?'calendar':id) as ProviderName;
        let state=this.states.get(provider)??{status:'unconfigured',sourceId:null,updatedAt:null,data:null,errorCode:null};
        const calendar=provider==='calendar'?state.data as CalendarData|null:null;
        if(calendar&&(calendar.month!==clock.today.slice(0,7)||calendar.timeZone!==this.zone||calendar.weekStart!==this.weekStart)){
            state={...state,status:'loading',data:null,updatedAt:null,errorCode:null};
        }
        const view=cardState(state,this.connected,this.language);
        const success=view.updatedAt?new Intl.DateTimeFormat(this.locale,{timeZone:this.zone,hour:'2-digit',minute:'2-digit',hourCycle:this.hour12?'h12':'h23'}).format(Date.parse(view.updatedAt)):'';
        card.status.set_text(`${view.message}${view.kind==='stale'&&success?` · ${success}`:''}`);
        if(id==='calendar'){
            card.title.set_text(new Intl.DateTimeFormat(this.locale,{timeZone:this.zone,year:'numeric',month:'long'}).format(this.now));
            const grid=new St.BoxLayout({orientation:Clutter.Orientation.VERTICAL,style_class:'liquid-calendar-grid'});
            const days=monthGrid(clock.today.slice(0,7),this.weekStart);
            const dots=eventDays((view.data as CalendarData|null)?.events??[],days,this.zone);
            for(let row=0;row<1+days.length/7;row++){
                const line=new St.BoxLayout({x_expand:true});
                for(let column=0;column<7;column++){
                    const day=days[(row-1)*7+column];
                    const text=row===0?new Intl.DateTimeFormat(this.locale,{weekday:'narrow',timeZone:'UTC'}).format(Date.UTC(2026,10,1+(this.weekStart+column)%7)):String(day!.day);
                    const item=label(text,'liquid-calendar-day');item.x_expand=false;item.x_align=Clutter.ActorAlign.CENTER;item.y_align=Clutter.ActorAlign.CENTER;
                    // The fixed cell owns the highlight; the label keeps its
                    // natural line height so BinLayout can center the numeral.
                    const cell=new St.Widget({style_class:'liquid-calendar-cell',layout_manager:new Clutter.BinLayout(),width:27*this.scale,height:23*this.scale,x_expand:true});
                    if(day?.iso===clock.today)cell.add_style_class_name('liquid-calendar-today');else if(day&&!day.inMonth)item.add_style_class_name('liquid-calendar-muted');
                    cell.add_child(item);
                    if(day&&dots.has(day.iso)){
                        const dot=new St.Widget({style_class:day.iso===clock.today?'liquid-event-dot today':'liquid-event-dot',width:3*this.scale,height:3*this.scale,x_align:Clutter.ActorAlign.CENTER,y_align:Clutter.ActorAlign.END,y_expand:true});
                        cell.add_child(dot);item.accessible_name=this.t('{date} · 일정 있음',{date:day.iso});
                    }
                    line.add_child(cell);
                }
                grid.add_child(line);
            }
            card.body.add_child(grid);return;
        }
        if(view.data===null){
            if(id==='network'){
                const row=new St.BoxLayout({x_expand:true});
                for(const title of [this.t('↓ 다운로드'),this.t('↑ 업로드')]){const column=new St.BoxLayout({orientation:Clutter.Orientation.VERTICAL,x_expand:true});column.add_child(label(title));column.add_child(label('—','liquid-value'));row.add_child(column);}
                card.body.add_child(row);
            }else if(id==='weather')card.body.add_child(label('—°','liquid-big'));
            else if(id==='system')card.body.add_child(label('— %','liquid-value'));
            const prompt=this.t(view.kind==='unconfigured'?(id==='weather'?'표시할 도시를 선택하세요':'설정에서 캘린더를 연결하세요'):'연결되면 정보를 표시해요');
            card.body.add_child(label(prompt));return;
        }
        if(id==='agenda'){
            const data=view.data as CalendarData;
            const events=selectAgenda(data.events,this.now,clock.today,this.zone);
            if(!events.length)card.body.add_child(label(this.t('예정된 일정 없음')));
            for(const event of events){card.body.add_child(label(event.title||this.t('제목 없는 일정'),'liquid-agenda-title'));card.body.add_child(label(formatAgendaWhen(event,this.zone,this.locale,this.hour12,this.language),'liquid-agenda-time'));}
        }else if(id==='weather'){
            const data=view.data as ProviderMap['weather']['data'];if(!data)return;
            renderWeather(card,data,this.scale,this.locale,this.hour12,this.language);
        }else if(id==='system')renderSystem(card,view.data as NonNullable<ProviderMap['system']['data']>,this.scale,this.language);
        else if(id==='network')renderNetwork(card,view.data as NonNullable<ProviderMap['network']['data']>,this.scale,this.language);
        else if(id==='media')renderMedia(card,view.data as NonNullable<ProviderMap['media']['data']>,this.scale,this.language);
    }

    get diagnostics():object{return{cards:this.cards.size,layout:this.current,scroll:this.scroll.vadjustment.value};}
    destroy():void{this.scheme.disconnect(this.schemeSignal);this.scroll.vadjustment.disconnect(this.adjustmentSignal);for(const card of this.cards.values())card.destroy();this.cards.clear();this.actor.destroy();}
}
