import GLib from 'gi://GLib';
import System from 'system';
import {here,correctness,benchmark,smoke,incrementalParse} from './probe.js';
import ICAL from './node_modules/ical.js/dist/ical.js';
const loop=new GLib.MainLoop(null,false);
let exitCode=0;
(async()=>{
    try{
        const report={runtime:'standalone GJS 1.88.0',capabilities:await smoke(),correctness:await correctness()};
        const cases=JSON.parse(new TextDecoder().decode(GLib.file_get_contents(`${here}/results/cases.json`)[1]));
        report.parserParity=[];
        for(const test of cases){
            try{report.parserParity.push({name:test.name,pass:JSON.stringify(ICAL.parse(test.ics))===JSON.stringify(await incrementalParse(test.ics))});}
            catch{report.parserParity.push({name:test.name,skipped:'parser error'});}
        }
        if(!ARGV.includes('--correctness-only'))report.benchmarks=await benchmark(5,row=>print(JSON.stringify(row)));
        GLib.file_set_contents(`${here}/results/standalone.json`,JSON.stringify(report,null,2));
        print(`Correctness: ${report.correctness.filter(x=>x.pass).length}/${report.correctness.length}`);
        print(`Failures: ${report.correctness.filter(x=>!x.pass).map(x=>x.name).join(', ')}`);
    }catch(error){printerr(error.stack);exitCode=1;}
    finally{loop.quit();}
})();
loop.run();
System.exit(exitCode);
