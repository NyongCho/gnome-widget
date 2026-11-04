import test from 'node:test';
import assert from 'node:assert/strict';
import {computeLayout,selectMonitor,type LayoutConfig} from '../src/shared/layout.js';
import type {CardId} from '../src/shared/cards.js';
const all:CardId[]=['clock','calendar','agenda','weather','system','network','media'];
const config:LayoutConfig={monitor:'primary',anchor:'top-right',offsetX:24,offsetY:20,scale:1,visible:all};
const area={x:0,y:0,width:1280,height:800};
const measured={clock:144,calendar:246,agenda:112,weather:230,system:221,network:177,media:111};
test('left and right stacks pack independently with matching clock/weather dimensions',()=>{
 const r=computeLayout(config,area,all,measured);
 assert.deepEqual(r.cards.map(c=>[c.id,c.rect.x,c.rect.y,c.rect.width,c.rect.height]),[
  ['clock',0,0,232,230],['calendar',0,244,232,246],['agenda',0,504,232,112],
  ['weather',246,0,232,230],['system',246,244,232,221],['network',246,479,232,177],['media',246,670,232,111],
 ]);
 assert.equal(r.contentHeight,781);assert.equal(r.overflow,true);
 assert.ok(r.viewport.x>=area.x&&r.viewport.x+r.viewport.width<=area.width);
 assert.ok(r.viewport.y>=0&&r.viewport.y+r.viewport.height<=area.height);
});
test('custom column order and hidden cards do not change other-column positions',()=>{
 const custom:LayoutConfig={...config,cardColumns:{left:['weather','system','clock'],right:['calendar','network','agenda','media']}};
 const r=computeLayout(custom,area,all,measured);
 assert.deepEqual(r.cards.map(c=>[c.id,c.rect.x,c.rect.y]),[
  ['weather',0,0],['system',0,244],['clock',0,479],['calendar',246,0],['network',246,260],['agenda',246,451],['media',246,577],
 ]);
 const hidden=computeLayout(custom,area,all.filter(id=>id!=='system'),measured);
 assert.equal(hidden.cards.find(c=>c.id==='clock')!.rect.y,244);
 assert.deepEqual(hidden.cards.filter(c=>c.rect.x>0),r.cards.filter(c=>c.rect.x>0));
});
test('an empty left column stays empty and no cards yields only the toolbar',()=>{
 const r=computeLayout({...config,cardColumns:{left:[],right:all}},area,['clock','weather'],measured);
 assert.deepEqual(r.cards.map(c=>[c.id,c.rect.x,c.rect.y]),[['clock',246,0],['weather',246,244]]);
 const empty=computeLayout(config,area,[]);assert.equal(empty.contentHeight,0);assert.equal(empty.cards.length,0);
});
test('small workarea stacks left then right without dropping cards',()=>{
 const r=computeLayout(config,{x:900,y:40,width:300,height:420},all,measured);
 assert.equal(r.columns,1);assert.equal(r.overflow,true);assert.deepEqual(r.cards.map(c=>c.id),all);
 assert.ok(r.cards.every(c=>c.rect.x===0));
 for(let i=1;i<r.cards.length;i++)assert.equal(r.cards[i]!.rect.y,r.cards[i-1]!.rect.y+r.cards[i-1]!.rect.height+14);
 assert.ok(r.viewport.x>=900&&r.viewport.x+r.viewport.width<=1200);
});
test('clock follows weather height, retains a ready-size baseline when weather is hidden, and never clips its content',()=>{
 const height=(visible:string[],sizes:Record<string,number>,scale=1)=>computeLayout({...config,scale},area,visible,sizes).cards.find(c=>c.id==='clock')!.rect.height;
 assert.equal(height(['clock','weather'],{clock:144,weather:255}),255);
 assert.equal(height(['clock'],{clock:144}),230);
 assert.equal(height(['clock'],{clock:216},1.5),345);
 assert.equal(height(['clock','weather'],{clock:180,weather:112}),180);
});
test('measured heights include scale once and invalid values use defaults',()=>{
 const r=computeLayout({...config,scale:1.5},{...area,width:1600,height:1200},['clock','weather'],{clock:195,weather:330});
 assert.equal(r.cards[0]!.rect.height,330);assert.equal(r.cards[1]!.rect.height,330);
 assert.deepEqual(computeLayout(config,area,['clock','weather'],{clock:NaN,weather:-1}),computeLayout(config,area,['clock','weather']));
});
test('lost monitor falls back to an available primary monitor',()=>{
 assert.equal(selectMonitor('DP-2',[{id:'DP-1',primary:true},{id:'HDMI-1',primary:false}]),0);
 assert.equal(selectMonitor('HDMI-1',[{id:'DP-1',primary:true},{id:'HDMI-1',primary:false}]),1);
 assert.equal(selectMonitor('primary',[]),-1);
});
