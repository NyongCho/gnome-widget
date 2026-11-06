// Synthetic IO at the production provider boundary; no calendar parsing here.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {Cancellation} from '../../src/shared/dataClient.js';
const URL='https://calendar.google.com/calendar/ical/benchmark/public/basic.ics';
async function bytes(path,cancel){
    const io=new Gio.Cancellable(),unlink=cancel.onCancel(()=>io.cancel());
    try{return await new Promise((resolve,reject)=>Gio.File.new_for_path(path).load_contents_async(io,(file,result)=>{try{const [ok,data]=file.load_contents_finish(result);if(!ok)throw new Error('fixture IO');resolve(data);}catch(e){reject(e);}}));}
    finally{unlink();}
}
export async function configure(session,directory){
    await session.ready;session.stop();
    const drivers=session.deps.drivers,calendar=drivers.calendar;
    calendar.deps.secrets={async lookup(){return URL;}};
    const get=async(url,_limits,cancel)=>{
        if(url.startsWith('https://api.open-meteo.com/'))return bytes(`${directory}/weather.json`,cancel);
        if(!url.startsWith('https://calendar.google.com/'))throw new Error('unexpected fixture URL');
        const selected=new TextDecoder().decode(await bytes(`${directory}/selection.txt`,cancel)).trim();
        if(!['1k','10k','5mib','sparse'].includes(selected))throw new Error('invalid fixture');
        return bytes(`${directory}/${selected}.ics`,cancel);
    };
    // The services share one HTTP client. Keep its normal destroy/cancel ownership.
    calendar.deps.http.get=get;drivers.weather.http.get=get;
    await session.deps.config.mutate(tx=>tx.replace({...tx.current,
        calendar:{sourceId:GLib.uuid_string_random(),enabled:true,deletionPending:false},
        weather:{sourceId:GLib.uuid_string_random(),location:{id:'1',label:'Synthetic Seoul',latitude:37.56,longitude:126.97,timeZone:'UTC'}}}),new Cancellation());
}
