import test from 'node:test';
import assert from 'node:assert/strict';
import {computeLayout,selectMonitor,type LayoutConfig} from '../src/shared/layout.js';
const config:LayoutConfig={monitor:'primary',anchor:'top-right',offsetX:24,offsetY:20,scale:1,visible:['clock','calendar','weather','agenda','network']};
test('desktop layout uses two columns and keeps toolbar and viewport inside workarea',()=>{
 const area={x:1920,y:32,width:1920,height:1048};const result=computeLayout(config,area,config.visible);
 assert.equal(result.columns,2);assert.ok(result.viewport.x>=area.x);assert.ok(result.viewport.y>=area.y);
 assert.ok(result.viewport.x+result.viewport.width<=area.x+area.width);
 assert.ok(result.viewport.y+result.viewport.height<=area.y+area.height);
 assert.equal(result.cards.length,5);assert.equal(result.cards[0]!.id,'clock');assert.equal(result.cards[0]!.rect.width,(result.viewport.width-14)/2);
 assert.equal(result.overflow,false);
});
test('small workarea switches to one column and scrolls without dropping requested cards',()=>{
 const result=computeLayout({...config,offsetX:999,offsetY:999},{x:0,y:0,width:300,height:260},config.visible);
 assert.equal(result.columns,1);assert.equal(result.overflow,true);assert.equal(result.cards.length,5);
 assert.ok(result.viewport.x>=0 && result.viewport.x+result.viewport.width<=300);
 assert.ok(result.viewport.y>=0 && result.viewport.y+result.viewport.height<=260);
 assert.ok(result.viewport.height>result.toolbarHeight);
});
test('scale and hidden media do not leave inaccessible space or an empty row',()=>{
 const area={x:0,y:32,width:1280,height:768};
 const a=computeLayout({...config,scale:1.25},area,['clock','calendar','weather','network','media']);
 const b=computeLayout({...config,scale:1.25},area,['clock','calendar','weather','network']);
 assert.ok(a.contentHeight>b.contentHeight);assert.equal(b.cards.length,4);
 assert.ok(b.viewport.x+b.viewport.width<=1280);
});
test('lost monitor falls back to an available primary monitor',()=>{
 assert.equal(selectMonitor('DP-2',[{id:'DP-1',primary:true},{id:'HDMI-1',primary:false}]),0);
 assert.equal(selectMonitor('HDMI-1',[{id:'DP-1',primary:true},{id:'HDMI-1',primary:false}]),1);
 assert.equal(selectMonitor('primary',[]),-1);
});
test('measured content heights pack rows without retaining fixed footer space',()=>{
 const r=computeLayout(config,{x:0,y:0,width:1280,height:800},['clock','calendar','weather','network'],{clock:130,calendar:240,weather:220,network:160});
 assert.deepEqual(r.cards.map(c=>[c.id,c.rect.y,c.rect.height]),[['clock',0,130],['calendar',0,240],['weather',254,220],['network',254,160]]);
 assert.equal(r.contentHeight,474);
});
test('measured heights already include UI scale and invalid measurements use defaults',()=>{
 const scaled={...config,scale:1.5},area={x:0,y:0,width:1600,height:1200};
 const a=computeLayout(scaled,area,['clock','weather'],{clock:195,weather:330});
 assert.equal(a.cards[0]!.rect.height,195);assert.equal(a.cards[1]!.rect.y,0);assert.equal(a.cards[1]!.rect.height,330);
 const fallback=computeLayout(scaled,area,['clock','weather']);
 const invalid=computeLayout(scaled,area,['clock','weather'],{clock:NaN,weather:-1});
 assert.deepEqual(invalid,fallback);
});
test('arbitrary list order fills left then right with the clock taking one slot',()=>{
 const ids=['weather','system','clock','calendar','network','agenda'];
 const r=computeLayout(config,{x:0,y:0,width:1280,height:800},ids,{weather:200,system:100,clock:120,calendar:240,network:80,agenda:100});
 assert.deepEqual(r.cards.map(c=>[c.id,c.rect.x,c.rect.y,c.rect.width]),[
  ['weather',0,0,232],['system',246,0,232],['clock',0,214,232],['calendar',246,214,232],['network',0,468,232],['agenda',246,468,232],
 ]);
});
