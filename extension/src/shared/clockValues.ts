export function millisecondsToNextMinute(nowMs:number):number{return 60000-((nowMs%60000)+60000)%60000;}
export function clockValues(now:number,zone:string,hour12:boolean,locale:string):{today:string;date:string;weekday:string;time:string;month:string;day:string}{
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
    const get=(type:string)=>parts.find(p=>p.type===type)!.value;
    const format=(options:Intl.DateTimeFormatOptions)=>new Intl.DateTimeFormat(locale,{timeZone:zone,...options}).format(now);
    return{today:`${get('year')}-${get('month')}-${get('day')}`,day:String(Number(get('day'))),
        date:format({year:'numeric',month:'long',day:'numeric'}),weekday:format({weekday:'long'}),month:format({month:'long'}),
        time:format({hour:'2-digit',minute:'2-digit',...(hour12?{hour12:true}:{hourCycle:'h23'})})};
}
