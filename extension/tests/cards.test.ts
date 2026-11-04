import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeCardOrder,orderedVisibleCards,moveCard} from '../src/shared/cards.js';
test('saved order keeps known IDs once and appends missing cards',()=>{
 assert.deepEqual(normalizeCardOrder(['system','calendar','system','unknown','clock']),['system','calendar','clock','weather','agenda','network','media']);
 assert.deepEqual(normalizeCardOrder([]),['clock','calendar','weather','agenda','network','system','media']);
});
test('visibility changes preserve positions regardless of activation sequence',()=>{
 const order=['system','weather','clock','calendar','network','agenda','media'];
 assert.deepEqual(orderedVisibleCards(order,['calendar','system','clock']),['system','clock','calendar']);
 assert.deepEqual(orderedVisibleCards(order,['calendar','clock']),['clock','calendar']);
 assert.deepEqual(orderedVisibleCards(order,['calendar','clock','system']),['system','clock','calendar']);
 assert.deepEqual(orderedVisibleCards(order,['missing','system','system']),['system']);
});
test('moving rows swaps neighbors, keeps disabled slots and clamps boundaries',()=>{
 const original=['clock','calendar','weather','agenda','network','system','media'];
 const up=moveCard(original,'weather',-1);
 assert.deepEqual(up,['clock','weather','calendar','agenda','network','system','media']);
 assert.deepEqual(moveCard(up,'weather',1),original);
 assert.deepEqual(moveCard(original,'clock',-1),original);
 assert.deepEqual(moveCard(original,'media',1),original);
 assert.deepEqual(original,['clock','calendar','weather','agenda','network','system','media']);
});
