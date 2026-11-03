export interface CalendarDay{iso:string;day:number;inMonth:boolean}
export function monthGrid(month:string,weekStart:number):CalendarDay[]{
    if(!/^\d{4}-\d{2}$/.test(month)||weekStart<0||weekStart>6)throw new Error('Invalid calendar context');
    const [year,m]=month.split('-').map(Number) as [number,number];
    const first=new Date(Date.UTC(year,m-1,1));
    const offset=(first.getUTCDay()-weekStart+7)%7;
    return Array.from({length:42},(_,index)=>{
        const date=new Date(Date.UTC(year,m-1,index-offset+1));
        return{iso:date.toISOString().slice(0,10),day:date.getUTCDate(),inMonth:date.getUTCMonth()===m-1};
    });
}
