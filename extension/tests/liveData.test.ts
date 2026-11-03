import test from 'node:test';import assert from 'node:assert/strict';
import {requestedProviders,rateLabel} from '../src/shared/liveData.js';
test('only enabled cards request providers, including enabled but paused music',()=>{
 assert.deepEqual(requestedProviders(['clock']),[]);assert.deepEqual(requestedProviders(['calendar','agenda','weather','media']),['calendar','weather','media']);assert.deepEqual(requestedProviders(['system','network']),['system','network']);
});
test('network speed uses automatic binary units with a distinct unknown first sample',()=>{
 assert.equal(rateLabel(null),'측정 중');assert.equal(rateLabel(0),'0 B/s');assert.equal(rateLabel(500),'500 B/s');assert.equal(rateLabel(1024),'1.0 KiB/s');assert.equal(rateLabel(1048576),'1.0 MiB/s');assert.equal(rateLabel(2**30),'1.0 GiB/s');
});
