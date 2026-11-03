import './generate-validators.mjs';
import { build } from 'esbuild';
await build({entryPoints:['src/shared/validation.ts'],outdir:'dist/shared',bundle:true,format:'esm',platform:'browser',target:'es2022'});
import {copyFile} from 'node:fs/promises';
await build({entryPoints:['src/extension.ts','src/dbus.ts','src/shared/dataClient.ts','src/shared/providerStore.ts'],outdir:'dist',bundle:true,format:'esm',platform:'browser',target:'es2022',external:['gi://*','resource://*'],loader:{'.glsl':'text'}});
await copyFile('metadata.json','dist/metadata.json');
