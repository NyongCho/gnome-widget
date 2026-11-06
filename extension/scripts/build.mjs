import './generate-validators.mjs';
import {build} from 'esbuild';
import {copyFile,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {parseArgs} from 'node:util';
import {assertCalendarIsolated} from '../src/shared/buildPolicy.ts';

const {values}=parseArgs({options:{edition:{type:'string',default:'rust'}},strict:true});
if(!['rust','gjs'].includes(values.edition))throw new Error('Expected --edition rust or gjs');
const editions=JSON.parse(await readFile('editions.json','utf8'));
const edition=editions[values.edition],outdir=edition.output;
const sourceMetadata=JSON.parse(await readFile('metadata.json','utf8'));
const metadata=values.edition==='rust'?sourceMetadata:{...sourceMetadata,uuid:edition.uuid,'settings-schema':edition.schemaId,url:edition.homepage};
const common={bundle:true,format:'esm',platform:'browser',target:'es2022',external:['gi://*','resource://*','cairo','system'],loader:{'.glsl':'text','.json':'json'},
    define:{__LIQUID_EDITION__:JSON.stringify(edition),__LIQUID_BACKEND__:JSON.stringify(edition.backend)}};
// These are generated outputs selected by the fixed edition manifest.
await rm(outdir,{recursive:true,force:true});
await mkdir(outdir,{recursive:true});
const entryPoints=['src/extension.ts','src/prefs.ts'];
if(values.edition==='rust')entryPoints.push('src/dbus.ts','src/shared/dataClient.ts','src/shared/providerStore.ts');
const ui=await build({...common,entryPoints,outdir,metafile:true});
assertCalendarIsolated(ui.metafile);
if(values.edition==='gjs'){
    await build({...common,entryPoints:{'calendar-worker':'src/calendar-worker/main.ts'},outdir,splitting:true,banner:{js:'#!@GJS@ -m'}});
}else{
    await build({...common,entryPoints:['src/shared/validation.ts'],outdir:`${outdir}/shared`});
    await build({...common,entryPoints:{spike:'tests/gnome/spike.ts',preferences:'tests/gnome/preferences.js','card-order':'tests/gnome/card-order.js'},outdir:`${outdir}/tests`});
}
await writeFile(`${outdir}/metadata.json`,JSON.stringify(metadata,null,2)+'\n');
await copyFile('stylesheet.css',`${outdir}/stylesheet.css`);
await mkdir(`${outdir}/schemas`,{recursive:true});
const schema=(await readFile(`schemas/${editions.rust.schemaId}.gschema.xml`,'utf8'))
    .replace(`id="${editions.rust.schemaId}"`,`id="${edition.schemaId}"`)
    .replace(`path="${editions.rust.schemaPath}"`,`path="${edition.schemaPath}"`);
await writeFile(`${outdir}/schemas/${edition.schemaId}.gschema.xml`,schema);
execFileSync('glib-compile-schemas',['--strict',`${outdir}/schemas`]);
