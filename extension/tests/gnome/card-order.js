// Exercise the production preferences through a private settings backend and fixture service.
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk?version=4.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {fillSettingsWindow} from '../../src/prefs/pages.js';

if(GLib.getenv('GSETTINGS_BACKEND')!=='keyfile')throw new Error('private settings required');
const schemas=GLib.getenv('LIQUID_TEST_SCHEMAS');
if(!schemas)throw new Error('private schemas required');
const schema=Gio.SettingsSchemaSource.new_from_directory(schemas,Gio.SettingsSchemaSource.get_default(),false).lookup(GLib.getenv('LIQUID_TEST_SCHEMA')||'org.gnome.shell.extensions.liquid-widgets',false);
const settings=new Gio.Settings({settings_schema:schema});

// Acquire the fixture name before opening preferences; never contact an existing service.
const [ownership]=Gio.DBus.session.call_sync('org.freedesktop.DBus','/org/freedesktop/DBus','org.freedesktop.DBus','RequestName',new GLib.Variant('(su)',['org.local.LiquidWidgets',4]),new GLib.VariantType('(u)'),Gio.DBusCallFlags.NONE,-1,null).deep_unpack();
if(ownership!==1)throw new Error('private data service name required');
const fixturePath=GLib.build_filenamev([GLib.getenv('LIQUID_TEST_FIXTURES'),'protocol/snapshot-valid.json']);
const snapshot=JSON.parse(new TextDecoder().decode(GLib.file_get_contents(fixturePath)[1]));
snapshot.calendar={status:'unconfigured',sourceId:null,updatedAt:null,data:null,errorCode:null};
const fixture=Gio.DBusExportedObject.wrapJSObject(`<node><interface name="org.local.LiquidWidgets1">
 <signal name="ProviderChanged"><arg type="s"/><arg type="u"/><arg type="s"/></signal>
 <method name="GetSnapshot"><arg type="s" direction="out"/></method>
 <method name="Subscribe"><arg type="as" direction="in"/><arg type="s" direction="out"/></method>
 <method name="Unsubscribe"><arg type="s" direction="in"/></method>
 <method name="GetSettings"><arg type="s" direction="out"/></method>
</interface></node>`,{
 GetSnapshot(){return JSON.stringify(snapshot);},
 Subscribe(){return 'card-order-fixture';},
 Unsubscribe(){},
 GetSettings(){return JSON.stringify({calendarEnabled:false,calendarSecretDeletionPending:false,weatherLocation:null,networkInterface:'auto'});},
});
fixture.export(Gio.DBus.session,'/org/local/LiquidWidgets');

function walk(widget){const result=[widget];for(let child=widget.get_first_child();child;child=child.get_next_sibling())result.push(...walk(child));return result;}
const titles={clock:['날짜와 시계','Date and clock'],calendar:['월간 달력','Monthly calendar'],weather:['날씨','Weather'],agenda:['다가오는 일정','Upcoming events'],network:['네트워크','Network'],system:['CPU · 메모리 · 온도','CPU · Memory · Temperature'],media:['음악','Music']};
let window;
let keyEvents=0;
const control=Gio.DBusExportedObject.wrapJSObject(`<node><interface name="org.local.LiquidCardOrderTest1">
 <method name="State"><arg type="s" direction="out"/></method>
 <method name="Focus"><arg type="s" direction="in"/><arg type="s" direction="in"/></method>
 <method name="FocusClock"/>
 <method name="Reopen"/>
 <method name="Seed"><arg type="as" direction="in"/><arg type="as" direction="in"/><arg type="as" direction="in"/></method>
</interface></node>`,{
 State(){
  const widgets=walk(window);
  const rows={left:[],right:[]};
  const groups={left:null,right:null};
  for(const side of ['left','right']){
   const list=widgets.find(widget=>widget instanceof Gtk.ListBox&&widget.get_name()===`card-columns-${side}`);
   if(!list)continue; // The old single list must fail the column assertions.
   for(let group=list.get_parent();group;group=group.get_parent()){
    if(group instanceof Adw.PreferencesGroup){groups[side]={title:group.title,description:group.description};break;}
   }
   for(let index=0,row;(row=list.get_row_at_index(index));index++){
    const id=Object.keys(titles).find(key=>row.get_name()===`card-columns-${key}`||titles[key].includes(row.title));
    if(!id)continue;
    const children=walk(row);
    const control=which=>children.find(widget=>widget.get_name()===`card-columns-${id}-${which}`);
    const toggle=control('toggle'),up=control('up'),down=control('down'),transfer=control('transfer');
    rows[side].push({id,title:row.title,active:toggle?.active??false,upSensitive:up?.sensitive??null,downSensitive:down?.sensitive??null,upTooltip:up?.tooltip_text??null,downTooltip:down?.tooltip_text??null,transferTooltip:transfer?.tooltip_text??null,transferIcon:transfer?.icon_name??null});
   }
  }
  const focus=[];
  for(let widget=window.get_focus();widget;widget=widget.get_parent())focus.push(widget.get_name());
  const [left=[],right=[]]=settings.get_value('card-columns').deep_unpack();
  const clock=widgets.find(widget=>widget instanceof Adw.ComboRow&&widget.get_name()==='clock-style');
  const clockStyle=clock?{value:settings.get_string('clock-style'),title:clock.title,selected:clock.selected,labels:Array.from({length:clock.model.get_n_items()},(_,index)=>clock.model.get_item(index).get_string())}:null;
  return JSON.stringify({columns:{left,right},visible:settings.get_strv('visible'),rows,groups,clockStyle,language:settings.get_string('language'),keyEvents,focus});
 },
 Focus(id,which){
  if(!['up','down','toggle','transfer'].includes(which))throw new Error('unknown card control');
  window.set_visible_page_name('widgets');
  const name=`card-columns-${id}-${which}`;
  const widget=walk(window).find(item=>item.get_name()===name);
  if(!widget)throw new Error(`missing card control: ${name}`);
  if(!widget.grab_focus())throw new Error(`card control did not receive focus: ${name}`);
  window.present();
 },
 FocusClock(){
  window.set_visible_page_name('widgets');
  const row=walk(window).find(widget=>widget instanceof Adw.ComboRow&&widget.get_name()==='clock-style');
  if(!row)throw new Error('missing clock style control');
  // ComboRow itself opens its popover unless an explicit activatable widget is set.
  const control=row.get_activatable_widget()??row;
  if(!control.grab_focus())throw new Error('clock style control did not receive focus');
  window.present();
 },
 Reopen(){app.hold();window.close();openWindow();app.release();},
 Seed(left,right,visible){settings.set_strv('visible',visible);settings.set_value('card-columns',new GLib.Variant('aas',[left,right]));Gio.Settings.sync();},
});
control.export(Gio.DBus.session,'/org/local/LiquidCardOrderTest');
Gio.bus_own_name_on_connection(Gio.DBus.session,'org.local.LiquidCardOrderTest',Gio.BusNameOwnerFlags.NONE,null,null);
const app=new Adw.Application({application_id:'org.local.LiquidCardOrderHarness'});
function openWindow(){
 window=new Adw.PreferencesWindow({application:app,title:'Liquid Card Order Keyboard Test'});
 fillSettingsWindow(window,settings,GLib.getenv('LIQUID_TEST_WORKER'));
 const controller=new Gtk.EventControllerKey({propagation_phase:Gtk.PropagationPhase.CAPTURE});
 controller.connect('key-pressed',()=>{keyEvents++;return false;});
 window.add_controller(controller);
 window.present();
}
app.connect('activate',openWindow);
app.run([]);
