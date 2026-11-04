import './generate-validators.mjs';
import { build } from 'esbuild';
await build({entryPoints:['src/shared/validation.ts'],outdir:'dist/shared',bundle:true,format:'esm',platform:'browser',target:'es2022'});
import {copyFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
await build({entryPoints:['src/extension.ts','src/prefs.ts','src/dbus.ts','src/shared/dataClient.ts','src/shared/providerStore.ts'],outdir:'dist',bundle:true,format:'esm',platform:'browser',target:'es2022',external:['gi://*','resource://*','cairo'],loader:{'.glsl':'text'}});
await copyFile('metadata.json','dist/metadata.json');

await copyFile('stylesheet.css','dist/stylesheet.css');
await mkdir('dist/schemas',{recursive:true});
await copyFile('schemas/org.gnome.shell.extensions.liquid-widgets.gschema.xml','dist/schemas/org.gnome.shell.extensions.liquid-widgets.gschema.xml');
execFileSync('glib-compile-schemas',['--strict','dist/schemas']);

await build({entryPoints:{spike:'tests/gnome/spike.ts',preferences:'tests/gnome/preferences.js'},outdir:'dist/tests',bundle:true,format:'esm',platform:'browser',target:'es2022',external:['gi://*','resource://*'],loader:{'.glsl':'text'}});
