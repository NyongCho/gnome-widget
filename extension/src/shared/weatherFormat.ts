import {translate,type Language,type Message} from './i18n.js';
import type {WeatherData} from '../types.js';
export interface WeatherView{temperature:string;description:string;icon:string;hours:{time:string;temperature:string;rain:string}[]}
export function weatherView(data:WeatherData,locale:string,hour12:boolean,language:Language='ko'):WeatherView|null{
    let format:Intl.DateTimeFormat;try{format=new Intl.DateTimeFormat(locale,{timeZone:data.timeZone,hour:'2-digit',hourCycle:hour12?'h12':'h23'});}catch{return null;}
    const code=data.current.code;
    let description:Message='날씨 정보 없음',icon='weather-severe-alert-symbolic';
    if(code===0){description='맑음';icon='weather-clear-symbolic';}
    else if(code===1||code===2){description='구름 조금';icon='weather-few-clouds-symbolic';}
    else if(code===3){description='흐림';icon='weather-overcast-symbolic';}
    else if(code===45||code===48){description='안개';icon='weather-fog-symbolic';}
    else if(code!==null&&[51,53,55,56,57].includes(code)){description='이슬비';icon='weather-showers-scattered-symbolic';}
    else if(code!==null&&[61,63,65,66,67,80,81,82].includes(code)){description='비';icon='weather-showers-symbolic';}
    else if(code!==null&&[71,73,75,77,85,86].includes(code)){description='눈';icon='weather-snow-symbolic';}
    else if(code!==null&&[95,96,99].includes(code)){description='뇌우';icon='weather-storm-symbolic';}
    const temperature=(value:number|null)=>value===null?'—°':`${Math.round(value)}°`;
    return{temperature:temperature(data.current.temperatureC),description:translate(language,description),icon,hours:data.hourly.map(hour=>({time:format.format(Date.parse(hour.at)),temperature:temperature(hour.temperatureC),rain:hour.precipitationProbability===null?'—':`${Math.round(hour.precipitationProbability)}%`}))};
}
