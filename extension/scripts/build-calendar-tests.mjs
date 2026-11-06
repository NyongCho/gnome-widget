import {build} from 'esbuild';
await build({entryPoints:['tests/gjs/calendarEngine.ts','tests/gjs/calendarBudget.ts'],outdir:'dist/tests',bundle:true,
    format:'esm',platform:'browser',target:'es2022',external:['gi://*','system'],loader:{'.json':'json'}});
