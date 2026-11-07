import { readFile, mkdir, writeFile } from 'node:fs/promises';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import standaloneCode from 'ajv/dist/standalone/index.js';
import { build } from 'esbuild';
const ajv = new Ajv({code: {source: true, esm: true}, strict: true, allErrors: false});
addFormats(ajv);
const snapshot = JSON.parse(await readFile(new URL('../../protocol/snapshot.schema.json', import.meta.url), 'utf8'));
const settings = JSON.parse(await readFile(new URL('../../protocol/settings.schema.json', import.meta.url), 'utf8'));
ajv.addSchema(snapshot); ajv.addSchema(settings);
const exports = {snapshot: snapshot.$id, settings: settings.$id, calendarContext: `${snapshot.$id}#/$defs/CalendarContext`, weatherLocation: `${settings.$id}#/$defs/WeatherLocationInput`, locationSearchResults: `${settings.$id}#/$defs/LocationSearchResults`};
for (const name of ['Calendar','Weather','System','Network','Media']) exports[name.toLowerCase()] = `${snapshot.$id}#/$defs/${name}State`;
const worker = JSON.parse(await readFile(new URL('../../protocol/calendar-worker.schema.json', import.meta.url), 'utf8'));
ajv.addSchema(worker);
for (const name of ['Header', 'Control', 'Reply']) exports[`worker${name}`] = `${worker.$id}#/$defs/${name}`;
const dataConfig = JSON.parse(await readFile(new URL('../../protocol/data-config.schema.json', import.meta.url), 'utf8'));
ajv.addSchema(dataConfig); exports.dataConfig = dataConfig.$id;
const calendarStatus = JSON.parse(await readFile(new URL('../../protocol/calendar-status.schema.json', import.meta.url), 'utf8'));
ajv.addSchema(calendarStatus); exports.calendarSummary = calendarStatus.$id;
const dir = new URL('../generated/', import.meta.url);
const sources = new URL('validator-sources/', dir);
await mkdir(sources, {recursive: true});
// Omit unused validator entries, but preserve the shared helpers' initialization imports.
await writeFile(new URL('package.json', dir), JSON.stringify({type:'module',sideEffects:['./validators/chunk-*.js']})+'\n');
const entryPoints = {};
for (const [name, id] of Object.entries(exports)) {
    const path = new URL(`${name}.js`, sources);
    await writeFile(path, standaloneCode(ajv, {[name]:id}));
    entryPoints[name] = path.pathname;
}
// Share Ajv's helper code without shipping Node or the schema compiler.
await build({entryPoints, outdir:new URL('validators/', dir).pathname, bundle:true, splitting:true, format:'esm', platform:'browser', target:'es2022'});
await writeFile(new URL('validators.js', dir), Object.keys(exports).map(name=>`export {${name}} from './validators/${name}.js';`).join('\n')+'\n');
await writeFile(new URL('validators.d.ts', dir), Object.keys(exports).map(name=>`export function ${name}(data: unknown): boolean;`).join('\n')+'\n');
