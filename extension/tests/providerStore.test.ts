import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ProviderStore} from '../src/shared/providerStore.js';
import {parseSnapshot, parseProviderState} from '../src/shared/validation.js';
const fixture = () => parseSnapshot(readFileSync(new URL('../../tests/fixtures/protocol/snapshot-valid.json', import.meta.url), 'utf8'));
test('provider_revision_is_monotonic', () => {
    const store=new ProviderStore();
    const data=fixture();
    store.acceptSnapshot(data);
    const changed={...data.system, errorCode:'NETWORK_ERROR',status:'stale'} as const;
    assert.equal(store.applyChange('system',4,changed),true);
    assert.equal(store.applyChange('system',3,data.system),false);
    assert.equal(store.applyChange('system',4,data.system),false);
    assert.equal(store.get('system').status,'stale');
    assert.deepEqual(store.get('calendar'),data.calendar);
});
test('snapshot cannot overwrite a signal received during subscription', () => {
    const store=new ProviderStore(); const data=fixture();
    store.applyChange('system',9,{...data.system,status:'stale',errorCode:'NETWORK_ERROR'});
    store.acceptSnapshot(data);
    assert.equal(store.get('system').status,'stale');
    assert.deepEqual(store.get('calendar'),data.calendar);
});
test('owner reset keeps last values but permits a new owner revision 1', () => {
    const store=new ProviderStore(); const data=fixture();
    store.acceptSnapshot(data); store.applyChange('system',99,data.system);
    store.resetOwner(); assert.deepEqual(store.get('system'),data.system);
    const restarted=fixture(); restarted.revisions.system=1;
    restarted.system={...data.system,status:'stale',errorCode:'NETWORK_ERROR'};
    store.acceptSnapshot(restarted); assert.equal(store.get('system').status,'stale');
});
test('unknown providers and malformed or oversized signal payloads fail without changing the store', () => {
    const store=new ProviderStore(); const data=fixture(); store.acceptSnapshot(data);
    assert.throws(()=>parseProviderState('unknown' as 'system','{}'));
    assert.throws(()=>parseProviderState('system',' '.repeat(512*1024+1)));
    assert.throws(()=>parseProviderState('system',JSON.stringify(data.calendar)));
    assert.throws(()=>store.applyChange('system',-1,data.system));
    assert.throws(()=>store.applyChange('system',2**32,data.system));
    assert.deepEqual(store.get('system'),data.system);
});
