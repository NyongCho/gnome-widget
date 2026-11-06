import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {getEdition} from '../src/edition.js';
import {RustWidgetSession} from '../src/backend/rust.js';
import {ProviderStore} from '../src/shared/providerStore.js';
import type {Transport} from '../src/shared/dataClient.js';

test('Rust retains existing metadata, schema, cache and secret identity',()=>{
    const edition=getEdition('rust');
    assert.equal(edition.uuid,'liquid-widgets@local');
    assert.equal(edition.schemaId,'org.gnome.shell.extensions.liquid-widgets');
    assert.equal(edition.schemaPath,'/org/gnome/shell/extensions/liquid-widgets/');
    assert.equal(edition.dataDirectory,'liquid-widgets');assert.equal(edition.secretApplication,'org.local.LiquidWidgets');
    assert.equal(edition.output,'dist');
    const metadata=JSON.parse(readFileSync(new URL('../metadata.json',import.meta.url),'utf8'));
    assert.equal(edition.uuid,metadata.uuid);assert.equal(edition.schemaId,metadata['settings-schema']);
});
test('public identity has separate settings, data and build namespaces',()=>{
    const edition=getEdition('gjs');
    assert.equal(edition.uuid,'liquid-widgets@nyongcho.github.io');
    assert.equal(edition.schemaId,'org.gnome.shell.extensions.liquid-widgets-public');
    assert.equal(edition.schemaPath,'/org/gnome/shell/extensions/liquid-widgets-public/');
    assert.equal(edition.dataDirectory,'liquid-widgets-public');assert.equal(edition.secretApplication,'io.github.NyongCho.LiquidWidgets');
    assert.equal(edition.output,'dist-gjs');assert.equal(edition.homepage,'https://github.com/NyongCho/gnome-widget');
    assert.throws(()=>getEdition('unknown'));
});
test('Rust adapter retains transport behavior and destroy releases the session once',()=>{
    let watched=0,released=0;
    const transport:Transport={schedule(){return()=>{};},watchOwner(){watched++;return()=>{released++;};},watchChanges(){return()=>{};},async call(){return[];}};
    const session=new RustWidgetSession(transport,{extensionPath:'/synthetic',store:new ProviderStore(),changed(){},connection(){}});
    session.start(['calendar']);assert.equal(watched,1);
    session.stop();assert.equal(released,1);
    session.start(['weather']);assert.equal(watched,2);
    session.destroy();session.destroy();assert.equal(released,2);
    session.start(['system']);assert.equal(watched,2,'destroyed adapter cannot restart');
});

test('build guard follows UI chunks and rejects calendar engine and time zone imports',async()=>{
    const {assertCalendarIsolated}=await import('../src/shared/buildPolicy.js');
    const graph={outputs:{'dist/extension.js':{entryPoint:'src/extension.ts',inputs:{'src/extension.ts':{}},imports:[{path:'dist/chunk.js'}]},'dist/chunk.js':{inputs:{'vendor/timezones/zones.json':{}},imports:[]}}};
    assert.throws(()=>assertCalendarIsolated(graph),/Calendar engine in UI/);
    assert.doesNotThrow(()=>assertCalendarIsolated({outputs:{'dist/calendar-worker.js':{entryPoint:'src/calendar-worker/main.ts',inputs:{'src/calendar-worker/engine.ts':{}},imports:[]}}}));
});

test('both emitted editions carry the selected metadata and schema without mutating source',async()=>{
    const {spawnSync}=await import('node:child_process');
    const {existsSync}=await import('node:fs');
    const root=new URL('../',import.meta.url);
    const original=readFileSync(new URL('metadata.json',root),'utf8');
    for(const name of ['gjs','rust']){
        const built=spawnSync(process.execPath,['scripts/build.mjs','--edition',name],{cwd:root,encoding:'utf8'});
        assert.equal(built.status,0,built.stderr);
        const edition=getEdition(name),base=new URL(`${edition.output}/`,root);
        const metadata=JSON.parse(readFileSync(new URL('metadata.json',base),'utf8'));
        assert.equal(metadata.uuid,edition.uuid);assert.equal(metadata['settings-schema'],edition.schemaId);
        const schema=readFileSync(new URL(`schemas/${edition.schemaId}.gschema.xml`,base),'utf8');
        assert.ok(schema.includes(`id="${edition.schemaId}"`));assert.ok(schema.includes(`path="${edition.schemaPath}"`));
        if(name==='gjs'){
            assert.ok(existsSync(new URL('calendar-worker.js',base)));
            assert.ok(readFileSync(new URL('calendar-worker.js',base),'utf8').startsWith('#!@GJS@ -m\n'));
            for(const file of ['extension.js','prefs.js'])assert.ok(!readFileSync(new URL(file,base),'utf8').includes('vendor/timezones/zones.json'));
        }
    }
    assert.equal(readFileSync(new URL('metadata.json',root),'utf8'),original);
});
