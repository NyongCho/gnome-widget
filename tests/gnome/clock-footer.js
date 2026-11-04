import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import {capture,findNamed} from './helpers.js';
export const METRICS={};
function check(value,message){if(!value)throw new Error(message);}
export async function run(){
 Main.overview.hide();await Scripting.sleep(1000);
 const ext=Main.extensionManager.lookup('liquid-widgets@local').stateObj,host=ext.host,settings=ext.settings;
 ext.client.stop();ext.client=null;ext.clock.destroy();ext.clock=null;
 settings.set_string('language','ko');settings.set_double('scale',1);settings.set_string('clock-style','digital');
 settings.set_strv('visible',['clock','weather']);host.setConnected(true);
 const now=Date.parse('2026-11-04T01:08:38Z');host.tick(now,'Asia/Seoul',false,'ko-KR',1);
 host.updateProvider('weather',{status:'ok',sourceId:'footer-fixture',updatedAt:new Date(now).toISOString(),errorCode:null,data:{location:'서울특별시 · 대한민국',timeZone:'Asia/Seoul',current:{temperatureC:16,code:2},hourly:Array.from({length:6},(_,i)=>({at:new Date(now+(i+1)*3600000).toISOString(),temperatureC:16-i,precipitationProbability:10*i})),attributionUrl:'https://open-meteo.com/'}});
 await Scripting.sleep(300);
 const card=host.cards.get('clock'),date=findNamed(card.body,'liquid-clock-date'),face=host.clockFaces.get(card);
 const read=()=>{
  const [,y]=date.get_transformed_position(),[,h]=date.get_transformed_size(),[,top]=card.button.get_transformed_position();
  return {dateY:y-top,dateHeight:h,cardHeight:card.button.height,faceHeight:face.actor.height,footerY:face.dateBox.y,bottomGap:card.button.height-(y-top+h)};
 };
 const [,faceY]=face.actor.get_transformed_position(),[,faceHeight]=face.actor.get_transformed_size();
 const [,footerY]=face.dateBox.get_transformed_position(),[,footerHeight]=face.dateBox.get_transformed_size();
 check(Math.abs(footerY+footerHeight-faceY-faceHeight)<=1,'date footer is not at the bottom of the clock face');
 const initial=read(),samples=[{change:'initial',...initial}];await capture('footer-before');
 for(const [key,value] of [['clock-style','square'],['clock-style','classic'],['clock-style','minimal'],['clock-style','digital'],['strength',0],['strength',20],['opacity',.05],['opacity',.24],['clock-style','square'],['clock-style','digital']]){
  if(typeof value==='string')settings.set_string(key,value);else settings.set_double(key,value);
  for(const wait of [20,60,150]){await Scripting.sleep(wait);samples.push({change:`${key}=${value}`,wait,...read()});}
 }
 await capture('footer-after');
 GLib.file_set_contents(`${GLib.getenv('LIQUID_TEST_OUTPUT')}/footer.json`,JSON.stringify(samples,null,2));
 print('CLOCK_FOOTER: '+JSON.stringify(samples));
 const moved=samples.filter(s=>s.cardHeight===initial.cardHeight&&Math.abs(s.dateY-initial.dateY)>.5);
 check(!moved.length,`date moved within an unchanged clock card: ${JSON.stringify(moved)}`);
 print('CLOCK_FOOTER: style/material changes preserve the date position');
}
