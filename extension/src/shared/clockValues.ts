export function millisecondsToNextMinute(nowMs:number):number{return 60000-((nowMs%60000)+60000)%60000;}
// GLib truncates intervals to integer milliseconds; never schedule a zero-delay burst.
export function millisecondsToNextSecond(nowMs:number):number{return Math.ceil(1000-((nowMs%1000)+1000)%1000);}
export type ClockStyle='digital'|'square'|'classic'|'minimal';
export function clockStyle(value:string):ClockStyle{return value==='square'||value==='classic'||value==='minimal'?value:'digital';}
export function clockFaceValues(now:number,zone:string,hour12:boolean,locale:string){
    const options={timeZone:zone,hour:'2-digit',minute:'2-digit',second:'2-digit'} as const;
    const wall=new Intl.DateTimeFormat('en-GB',{...options,hourCycle:'h23'}).formatToParts(now);
    const get=(parts:Intl.DateTimeFormatPart[],type:string)=>parts.find(part=>part.type===type)?.value??'';
    const hours=Number(get(wall,'hour')),minutes=Number(get(wall,'minute')),seconds=Number(get(wall,'second'));
    const display=new Intl.DateTimeFormat(locale,{...options,...(hour12?{hour12:true}:{hourCycle:'h23' as const})}).formatToParts(now);
    const date=new Intl.DateTimeFormat(locale,{timeZone:zone,month:'short',day:'numeric',weekday:'long'}).format(now);
    return{digits:`${get(display,'hour')}:${get(display,'minute')}`,dayPeriod:get(display,'dayPeriod'),date,
        hourAngle:(hours%12+minutes/60+seconds/3600)*30,minuteAngle:(minutes+seconds/60)*6,secondAngle:seconds*6};
}
export function clockValues(now:number,zone:string,hour12:boolean,locale:string):{today:string;date:string;weekday:string;time:string;month:string;day:string}{
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
    const get=(type:string)=>parts.find(p=>p.type===type)!.value;
    const format=(options:Intl.DateTimeFormatOptions)=>new Intl.DateTimeFormat(locale,{timeZone:zone,...options}).format(now);
    return{today:`${get('year')}-${get('month')}-${get('day')}`,day:String(Number(get('day'))),
        date:format({year:'numeric',month:'long',day:'numeric'}),weekday:format({weekday:'long'}),month:format({month:'long'}),
        time:format({hour:'2-digit',minute:'2-digit',...(hour12?{hour12:true}:{hourCycle:'h23'})})};
}
