import {Cancellation} from '../../shared/dataClient.js';
import {parseProviderState,parseWeatherLocation} from '../../shared/validation.js';
import type {ProviderMap,WeatherData,WeatherLocation} from '../../types.js';
import type {HttpClient,PrivateFiles} from '../contracts.js';
import {ConfigStore,WEATHER_CACHE_FILE} from '../config.js';
import {DataFailure,DataCancelled} from '../errors.js';
import type {ProviderContext,ProviderDriver} from '../scheduler.js';
const LIMITS={maxBytes:256*1024,timeoutMs:15000};
function record(value:unknown):Record<string,unknown>{return value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};}
function document(bytes:Uint8Array):Record<string,unknown>{
    if(bytes.length>LIMITS.maxBytes)throw new DataFailure('PAYLOAD_TOO_LARGE');
    try{const parsed:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||record(parsed).error===true)throw new Error();return record(parsed);}
    catch{throw new DataFailure('INVALID_DATA');}
}
function numeric(value:unknown):number|null{return typeof value==='number'&&Number.isFinite(value)?value:null;}
export function parseLocations(bytes:Uint8Array):WeatherLocation[]{
    const value=document(bytes);if(value.results===undefined)return[];if(!Array.isArray(value.results))throw new DataFailure('INVALID_DATA');
    const locations:WeatherLocation[]=[];
    for(const candidate of value.results.slice(0,20)){
        const row=record(candidate),id=numeric(row.id);
        if(id===null||!Number.isSafeInteger(id)||id<0||typeof row.name!=='string'||typeof row.timezone!=='string'||numeric(row.latitude)===null||numeric(row.longitude)===null)continue;
        const labels=[row.name];for(const key of ['admin1','country']){const label=row[key];if(typeof label==='string'&&label&&!labels.includes(label))labels.push(label);}
        try{const location=parseWeatherLocation(JSON.stringify({id:String(id),label:labels.join(' · '),latitude:row.latitude,longitude:row.longitude,timeZone:row.timezone}));if(location)locations.push(location);}catch{/* Ignore incomplete or out-of-range geocoder rows, as in Rust. */}
    }
    return locations;
}
export function parseForecast(bytes:Uint8Array,location:WeatherLocation,now:number):WeatherData {
    const value=document(bytes),hourly=record(value.hourly),current=record(value.current),times=hourly.time;
    if(!Number.isFinite(now)||!Array.isArray(times)||times.length>168)throw new DataFailure('INVALID_DATA');
    const temperatures=Array.isArray(hourly.temperature_2m)?hourly.temperature_2m:[],precipitations=Array.isArray(hourly.precipitation_probability)?hourly.precipitation_probability:[];
    const samples:WeatherData['hourly']=[];
    for(const [index,epoch] of times.entries()){
        if(typeof epoch!=='number'||!Number.isSafeInteger(epoch))throw new DataFailure('INVALID_DATA');if(epoch<now)continue;
        let at:string;try{at=new Date(epoch*1000).toISOString().replace('.000Z','Z');}catch{throw new DataFailure('INVALID_DATA');}
        const probability=numeric(precipitations[index]);samples.push({at,temperatureC:numeric(temperatures[index]),precipitationProbability:probability!==null&&probability>=0&&probability<=100?probability:null});
    }
    samples.sort((a,b)=>a.at.localeCompare(b.at));
    const code=numeric(current.weather_code);
    return{location:location.label,timeZone:location.timeZone,current:{temperatureC:numeric(current.temperature_2m),code:code!==null&&Number.isInteger(code)&&code>=0&&code<=99?code:null},hourly:samples.filter((sample,index)=>index===0||sample.at!==samples[index-1]?.at).slice(0,6),attributionUrl:'https://open-meteo.com/'};
}
function query(parameters:Record<string,string|number>):string{return Object.entries(parameters).map(([key,value])=>`${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&');}
export class LocationSearch {
    private active=false;private last=-Infinity;
    constructor(private http:HttpClient,private monotonic:()=>number){}
    async searchLocations(queryText:string,cancel:Cancellation):Promise<WeatherLocation[]>{
        const text=queryText.trim(),length=[...text].length;if(length<2||length>100)throw new DataFailure('INVALID_DATA');
        if(cancel.cancelled)throw new DataCancelled();const now=this.monotonic();if(this.active||now-this.last<1000)throw new DataFailure('RATE_LIMITED');
        this.active=true;this.last=now;
        try{const response=await this.http.get(`https://geocoding-api.open-meteo.com/v1/search?${query({name:text,count:10,language:'ko',format:'json'})}`,LIMITS,cancel);if(cancel.cancelled)throw new DataCancelled();return parseLocations(response);}
        finally{this.active=false;}
    }
}
export class WeatherProvider implements ProviderDriver<'weather'> {
    constructor(private http:HttpClient,private files:PrivateFiles,private config:ConfigStore){}
    async collect(context:ProviderContext):Promise<ProviderMap['weather']>{
        const {sourceId,location}=context.config.weather,cancel=context.cancel;
        if(!sourceId||!location)return{status:'unconfigured',sourceId:null,updatedAt:null,data:null,errorCode:null};
        if(cancel.cancelled)throw new DataCancelled();
        try{
            const bytes=await this.http.get(`https://api.open-meteo.com/v1/forecast?${query({latitude:location.latitude,longitude:location.longitude,timezone:location.timeZone,timeformat:'unixtime',forecast_hours:7,temperature_unit:'celsius',current:'temperature_2m,weather_code',hourly:'temperature_2m,precipitation_probability'})}`,LIMITS,cancel);
            if(cancel.cancelled)throw new DataCancelled();
            const data=parseForecast(bytes,location,Math.floor(Date.parse(context.now)/1000));
            const state=parseProviderState('weather',JSON.stringify({status:'ok',sourceId,updatedAt:context.now,data,errorCode:null}));
            await this.config.mutate(async tx=>{
                if(tx.current.weather.sourceId!==sourceId||cancel.cancelled)throw new DataCancelled();
                await this.files.replace(WEATHER_CACHE_FILE,new TextEncoder().encode(JSON.stringify({schemaVersion:1,state})),cancel);
            },cancel);
            return state;
        }catch(error){
            if(cancel.cancelled||error instanceof DataCancelled)throw new DataCancelled();
            const failure=error instanceof DataFailure?error:new DataFailure('INVALID_DATA');
            if((await this.config.read(cancel)).weather.sourceId!==sourceId)throw new DataCancelled();
            try{
                const bytes=await this.files.read(WEATHER_CACHE_FILE,512*1024,cancel);
                if(bytes){const cache=record(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
                    if(cache.schemaVersion!==1||Object.keys(cache).some(key=>key!=='schemaVersion'&&key!=='state'))throw new Error();
                    const state=parseProviderState('weather',JSON.stringify(cache.state));
                    if(state.sourceId===sourceId&&state.status==='ok'){
                        if(cancel.cancelled||(await this.config.read(cancel)).weather.sourceId!==sourceId)throw new DataCancelled();
                        return{...state,status:'stale',errorCode:failure.code};
                    }
                }
            }catch(error){if(cancel.cancelled||error instanceof DataCancelled)throw new DataCancelled();/* Ignore unreadable or incompatible caches. */}
            throw failure;
        }
    }
}
