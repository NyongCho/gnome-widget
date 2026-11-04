import test from 'node:test';import assert from 'node:assert/strict';
import {normalizeCardColumns,visibleCardColumns,moveCard,transferCard} from '../src/shared/cards.js';
const defaults={left:['clock','calendar','agenda'],right:['weather','system','network','media']} as const;
test('column normalization preserves each known card once and appends missing cards to their default side',()=>{
 assert.deepEqual(normalizeCardColumns({left:[],right:[]}),defaults);
 assert.deepEqual(normalizeCardColumns({left:['weather','clock','clock','bad'],right:['weather','system']}),{left:['weather','clock','calendar','agenda'],right:['system','network','media']});
});
test('disabled cards retain their side and position regardless of enable sequence',()=>{
 const columns=normalizeCardColumns(defaults);
 assert.deepEqual(visibleCardColumns(columns,['network','agenda','clock']),{left:['clock','agenda'],right:['network']});
 assert.deepEqual(visibleCardColumns(columns,['network','agenda']),{left:['agenda'],right:['network']});
 assert.deepEqual(visibleCardColumns(columns,['network','agenda','clock']),{left:['clock','agenda'],right:['network']});
});
test('within-column movement swaps only neighbors and respects boundaries',()=>{
 const columns=normalizeCardColumns(defaults);
 assert.deepEqual(moveCard(columns,'agenda',-1),{left:['clock','agenda','calendar'],right:defaults.right});
 assert.deepEqual(moveCard(columns,'clock',-1),columns);assert.deepEqual(moveCard(columns,'media',1),columns);
 assert.deepEqual(columns,defaults);
});
test('cross-column movement appends once, preserves the other rows, and permits an empty side',()=>{
 let columns=normalizeCardColumns(defaults);
 columns=transferCard(columns,'calendar','right');
 assert.deepEqual(columns,{left:['clock','agenda'],right:['weather','system','network','media','calendar']});
 assert.deepEqual(transferCard(columns,'calendar','right'),columns);
 columns=transferCard(transferCard(columns,'clock','right'),'agenda','right');
 assert.deepEqual(columns.left,[]);assert.equal(new Set(columns.right).size,7);
 assert.deepEqual(normalizeCardColumns(columns),columns);
 assert.deepEqual(transferCard(columns,'calendar','left').left,['calendar']);
});
