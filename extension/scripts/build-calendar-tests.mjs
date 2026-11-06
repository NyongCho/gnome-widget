import {build} from 'esbuild';
const shared={bundle:true,format:'esm',platform:'browser',target:'es2022',external:['gi://*','system'],loader:{'.json':'json'}};
await build({...shared,entryPoints:['tests/gjs/calendarEngine.ts','tests/gjs/calendarBudget.ts','tests/gjs/worker.ts','tests/gjs/workerFixtures.ts','tests/gjs/io.ts','tests/gjs/leaseHolder.ts','tests/gjs/localSession.ts','tests/gjs/weather.ts','tests/gjs/systemNetwork.ts','tests/gjs/media.ts'],outdir:'dist/tests'});
await build({...shared,entryPoints:{'calendar-worker':'src/calendar-worker/main.ts'},outdir:'dist/tests',splitting:true,banner:{js:'#!@GJS@ -m'}});
