interface BuildGraph {outputs:Record<string,{entryPoint?:string;inputs:Record<string,unknown>;imports:{path:string;external?:boolean}[]}>}
/** Public UI cannot initialize the expensive recurrence/time-zone dependency graph. */
export function assertCalendarIsolated(graph:BuildGraph):void {
    const forbidden=/(?:^|\/)(?:calendar-worker\/|vendor\/(?:ical|timezones)\/)/;
    const visit=(path:string,seen:Set<string>)=>{
        if(seen.has(path))return;seen.add(path);
        const output=graph.outputs[path];if(!output)return;
        for(const input of Object.keys(output.inputs))if(forbidden.test(input))throw new Error(`Calendar engine in UI dependency graph: ${input}`);
        for(const dependency of output.imports)if(!dependency.external)visit(dependency.path,seen);
    };
    for(const [path,output] of Object.entries(graph.outputs))
        if(output.entryPoint&&/(?:^|\/)(?:extension|prefs)\.ts$/.test(output.entryPoint))visit(path,new Set());
}
