// Build-time only: inspect actual module operands, excluding strings/comments.
import {build} from 'esbuild';
import {readFileSync} from 'node:fs';
const files=JSON.parse(readFileSync(0,'utf8')),result={};
for(const [name,source] of Object.entries(files)){
    const parsed=await build({stdin:{contents:source,sourcefile:name,loader:'js'},
        bundle:true,external:['*'],write:false,metafile:true,format:'esm',logLevel:'silent'});
    // Input metadata describes parsed imports before output tree-shaking.
    result[name]=Object.values(parsed.metafile.inputs).flatMap(input=>input.imports.map(value=>value.path));
}
process.stdout.write(JSON.stringify(result));
