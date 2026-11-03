import test from 'node:test';import assert from 'node:assert/strict';
import {cardState} from '../src/shared/cardState.js';
import type {ProviderState} from '../src/types.js';
const base:ProviderState<{events:unknown[]}>={status:'unconfigured',sourceId:'a',updatedAt:null,data:null,errorCode:null};
test('card_states_do_not_fabricate_values',()=>{
 assert.equal(cardState(base,true).kind,'unconfigured');assert.equal(cardState({...base,status:'loading'},true).kind,'loading');
 const empty={...base,status:'ok',updatedAt:'2026-11-04T00:00:00Z',data:{events:[]}} as const;
 assert.equal(cardState(empty,true).kind,'ready');assert.deepEqual(cardState(empty,true).data,{events:[]});
 assert.equal(cardState(empty,false).kind,'stale');assert.equal(cardState(empty,false).updatedAt,empty.updatedAt);
 assert.equal(cardState({...base,status:'unavailable',errorCode:'NETWORK_ERROR'},true).data,null);
 assert.equal(cardState(base,false).kind,'disconnected');
});
test('source switch loading state exposes no values from the previous source',()=>{
 const fresh={...base,sourceId:'b',status:'loading'} as const;
 assert.equal(cardState(fresh,true).data,null);
});
