import './generate-validators.mjs';
import { build } from 'esbuild';
await build({entryPoints:['src/shared/validation.ts'],outdir:'dist/shared',bundle:true,format:'esm',platform:'browser',target:'es2022'});
