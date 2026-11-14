import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Cancellation} from '../src/shared/dataClient.js';
import {ConfigStore,type ConfigTransaction} from '../src/data/config.js';
import {DataSettingsService} from '../src/data/settings.js';
import type {SecretStore} from '../src/data/contracts.js';
import type {PrivateFiles} from '../src/data/contracts.js';
const url='https://calendar.google.com/calendar/ical/synthetic/private-test/basic.ics';
const cancel=()=>new Cancellation();
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return{promise,resolve};}
function fixture(){
    const files=new Map<string,Uint8Array>(),secrets=new Map<string,string>(),events:string[]=[];
    let failWrite=false,failClear=false,saveGate:Promise<void>|null=null,tail=Promise.resolve();
    const privateFiles:PrivateFiles={async read(name){return files.get(name)?.slice()??null;},async replace(name,data){if(failWrite){failWrite=false;throw new Error('disk');}files.set(name,data.slice());events.push('write:'+name);},async remove(name){files.delete(name);events.push('remove:'+name);}};
    const secretStore:SecretStore={async lookup(id){return secrets.get(id)??null;},async save(id,value){events.push('save');await saveGate;secrets.set(id,value);},async remove(id){secrets.delete(id);events.push('remove-secret');},async clearAll(){events.push('clear');if(failClear)throw new Error('locked');secrets.clear();}};
    const config=new ConfigStore({files:privateFiles,uuid:randomUUID,watch(){return()=>{};},async acquire(c){const previous=tail,done=deferred();tail=done.promise;await previous;if(c.cancelled){done.resolve();throw new Error('CANCELLED');}return{release:done.resolve};}});
    const settings=new DataSettingsService(config,secretStore,privateFiles,randomUUID);
    return{files,secrets,events,config,settings,privateFiles,secretStore,set failWrite(v:boolean){failWrite=v;},set failClear(v:boolean){failClear=v;},set saveGate(v:Promise<void>|null){saveGate=v;}};
}
test('concurrent_connect_clear serializes keyring and configuration changes',async()=>{
    const f=fixture(),gate=deferred();f.saveGate=gate.promise;
    const connect=f.settings.setCalendarSecret(url,cancel());const clear=f.settings.clearCalendarSecret(cancel());
    await Promise.resolve();gate.resolve();await Promise.all([connect,clear]);
    assert.equal((await f.config.read(cancel())).calendar.enabled,false);assert.equal(f.secrets.size,0);
    assert.ok(f.events.indexOf('save')<f.events.indexOf('clear'));
});
test('write_failure_preserves_old_source and cleans only the uncommitted new secret',async()=>{
    const f=fixture();await f.settings.setCalendarSecret(url,cancel());const old=await f.config.read(cancel());
    f.failWrite=true;await assert.rejects(f.settings.setCalendarSecret(url,cancel()));
    assert.equal((await f.config.read(cancel())).calendar.sourceId,old.calendar.sourceId);
    assert.deepEqual([...f.secrets.keys()],[old.calendar.sourceId]);
});
test('delete_pending_survives_reconnect until an explicit successful disconnect',async()=>{
    const f=fixture();await f.settings.setCalendarSecret(url,cancel());f.failClear=true;
    await assert.rejects(f.settings.clearCalendarSecret(cancel()));
    assert.equal((await f.config.read(cancel())).calendar.deletionPending,true);
    f.failClear=false;await f.settings.setCalendarSecret(url,cancel());
    assert.equal((await f.config.read(cancel())).calendar.deletionPending,true);
    assert.equal(f.events.filter(x=>x==='clear').length,1,'connect must not clear the whole namespace');
    await f.settings.clearCalendarSecret(cancel());assert.equal((await f.config.read(cancel())).calendar.deletionPending,false);
});
test('stale_cache_writer_after_clear cannot recreate cache data',async()=>{
    const f=fixture();await f.settings.setCalendarSecret(url,cancel());const source=(await f.config.read(cancel())).calendar.sourceId;
    await f.settings.clearCalendarSecret(cancel());
    const wrote=await f.config.mutate(async tx=>{if(tx.current.calendar.sourceId!==source||!tx.current.calendar.enabled)return false;await f.privateFiles.replace('calendar-raw.ics',new Uint8Array([1]),cancel());return true;},cancel());
    assert.equal(wrote,false);assert.equal(f.files.has('calendar-raw.ics'),false);
});
test('transaction expires at release and replaces with a fresh revision UUID',async()=>{
    const f=fixture();let leaked!:ConfigTransaction;const before=await f.config.read(cancel());
    await f.config.mutate(async tx=>{leaked=tx;await tx.replace({...tx.current,networkInterface:'eth0'});},cancel());
    const after=await f.config.read(cancel());assert.notEqual(after.revision,before.revision);
    await assert.rejects(leaked.replace(after),/TRANSACTION_CLOSED/);
    assert.equal((await f.config.read(cancel())).networkInterface,'eth0');
});
test('missing_secret_gi_only_disables_calendar: non-secret settings remain usable',async()=>{
    const f=fixture();f.secretStore.save=async()=>{throw new Error('SERVICE_UNAVAILABLE');};
    await assert.rejects(f.settings.setCalendarSecret(url,cancel()));
    await f.settings.setNetworkInterface('wlan0',cancel());await f.settings.setWeatherLocation({id:'seoul',label:'Seoul',latitude:37.5,longitude:127,timeZone:'Asia/Seoul'},cancel());
    const settings=await f.settings.getSettings(cancel());assert.equal(settings.networkInterface,'wlan0');assert.equal(settings.weatherLocation?.label,'Seoul');
});
test('an uncertain old secret write cannot overwrite or delete a newer source',async()=>{
    const f=fixture();let late!:()=>void;const original=f.secretStore.save;
    f.secretStore.save=async(id,value)=>{late=()=>{f.secrets.set(id,value);};throw new Error('SERVICE_UNAVAILABLE');};
    await assert.rejects(f.settings.setCalendarSecret(url,cancel()));f.secretStore.save=original;
    await f.settings.setCalendarSecret(url,cancel());const source=(await f.config.read(cancel())).calendar.sourceId!;
    late();assert.equal(f.secrets.get(source),url);assert.equal((await f.config.read(cancel())).calendar.deletionPending,true);
});
test('configuration rejects oversized, unknown and invalid persisted data',async()=>{
    const f=fixture();f.files.set('settings.json',new Uint8Array(65537));await assert.rejects(f.config.read(cancel()));
    f.files.set('settings.json',new TextEncoder().encode(JSON.stringify({...await fixture().config.read(cancel()),privateUrl:url})));await assert.rejects(f.config.read(cancel()));
});

test('cache deletion failure after reconnect does not skip old-secret cleanup',async()=>{
    const f=fixture();await f.settings.setCalendarSecret(url,cancel());const previous=(await f.config.read(cancel())).calendar.sourceId!;
    f.privateFiles.remove=async()=>{throw new Error('disk');};
    await assert.rejects(f.settings.setCalendarSecret(url,cancel()));
    assert.equal(f.secrets.has(previous),false,'obsolete secret must be removed even if cache deletion fails');
    assert.ok(f.secrets.has((await f.config.read(cancel())).calendar.sourceId!),'new committed secret remains');
});

test('cancellation after committing a replacement flags the obsolete secret until disconnect', async () => {
    const f = fixture();
    await f.settings.setCalendarSecret(url, cancel());
    const previous = (await f.config.read(cancel())).calendar.sourceId!;
    const operation = cancel(), replace = f.privateFiles.replace;
    f.privateFiles.replace = async (name, bytes, cancellation) => {
        await replace(name, bytes, cancellation);
        if (name === 'settings.json') operation.cancel();
    };
    await assert.rejects(f.settings.setCalendarSecret(url, operation));
    const committed = await f.config.read(cancel());
    assert.notEqual(committed.calendar.sourceId, previous);
    assert.equal(f.secrets.get(committed.calendar.sourceId!), url);
    assert.equal(f.secrets.get(previous), url);
    assert.equal(committed.calendar.deletionPending, true);
    await f.settings.setCalendarSecret(url, cancel());
    assert.equal((await f.config.read(cancel())).calendar.deletionPending, true);
    await f.settings.clearCalendarSecret(cancel());
    assert.equal((await f.config.read(cancel())).calendar.deletionPending, false);
    assert.equal(f.secrets.size, 0);
});

test('cancellation before replacement commits removes only the unused new secret', async () => {
    const f = fixture();
    await f.settings.setCalendarSecret(url, cancel());
    const previous = await f.config.read(cancel());
    const operation = cancel();
    f.privateFiles.replace = async () => { operation.cancel(); throw new Error('CANCELLED'); };
    await assert.rejects(f.settings.setCalendarSecret(url, operation));
    assert.deepEqual(await f.config.read(cancel()), previous);
    assert.deepEqual([...f.secrets.keys()], [previous.calendar.sourceId]);
});

test('committed replacement retains cleanup intent even if subsequent config writes fail', async () => {
    const f = fixture();
    await f.settings.setCalendarSecret(url, cancel());
    const previous = (await f.config.read(cancel())).calendar.sourceId!;
    const operation = cancel(), replace = f.privateFiles.replace;
    let committed = false;
    f.privateFiles.replace = async (name, bytes, cancellation) => {
        if (committed) throw new Error('disk unavailable after rename');
        await replace(name, bytes, cancellation);
        committed = true;
        operation.cancel();
    };
    await assert.rejects(f.settings.setCalendarSecret(url, operation));
    const current = await f.config.read(cancel());
    assert.equal(f.secrets.get(current.calendar.sourceId!), url);
    assert.equal(f.secrets.get(previous), url);
    assert.equal(current.calendar.deletionPending, true);
    f.privateFiles.replace = replace;
    await f.settings.setCalendarSecret(url, cancel());
    assert.equal((await f.config.read(cancel())).calendar.deletionPending, true);
});

test('successful replacement clears only its own cleanup intent', async () => {
    const f = fixture();
    await f.settings.setCalendarSecret(url, cancel());
    await f.settings.setCalendarSecret(url, cancel());
    const current = await f.config.read(cancel());
    assert.deepEqual([...f.secrets.keys()], [current.calendar.sourceId]);
    assert.equal(current.calendar.deletionPending, false);
});

test('disconnect queued after a cancelled committed replacement stays cleared', async () => {
    const f = fixture();
    await f.settings.setCalendarSecret(url, cancel());
    const operation = cancel(), replace = f.privateFiles.replace;
    const committed = deferred(), resume = deferred();
    let first = true;
    f.privateFiles.replace = async (name, bytes, cancellation) => {
        await replace(name, bytes, cancellation);
        if (first) {
            first = false;
            committed.resolve();
            await resume.promise;
            operation.cancel();
        }
    };
    const replacing = assert.rejects(f.settings.setCalendarSecret(url, operation));
    await committed.promise;
    const clearing = f.settings.clearCalendarSecret(cancel());
    resume.resolve();
    await Promise.all([replacing, clearing]);
    assert.equal(f.secrets.size, 0);
    assert.deepEqual((await f.config.read(cancel())).calendar, {
        enabled: false, sourceId: null, deletionPending: false,
    });
});

test('failed old-secret removal keeps committed cleanup intent through reconnect', async () => {
    const f = fixture();
    await f.settings.setCalendarSecret(url, cancel());
    const previous = (await f.config.read(cancel())).calendar.sourceId!;
    const remove = f.secretStore.remove;
    f.secretStore.remove = async () => { throw new Error('locked'); };
    await f.settings.setCalendarSecret(url, cancel());
    assert.equal(f.secrets.get(previous), url);
    assert.equal((await f.config.read(cancel())).calendar.deletionPending, true);
    f.secretStore.remove = remove;
    await f.settings.setCalendarSecret(url, cancel());
    assert.equal((await f.config.read(cancel())).calendar.deletionPending, true);
    await f.settings.clearCalendarSecret(cancel());
    assert.equal(f.secrets.size, 0);
    assert.equal((await f.config.read(cancel())).calendar.deletionPending, false);
});
