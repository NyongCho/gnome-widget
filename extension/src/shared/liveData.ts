import {translate,type Language} from './i18n.js';
import type {ProviderName} from '../types.js';
import {PROVIDERS} from './providerStore.js';
export function requestedProviders(visible:readonly string[]):ProviderName[]{return PROVIDERS.filter(name=>visible.includes(name)||(name==='calendar'&&visible.includes('agenda')));}
export function rateLabel(bytes:number|null,language:Language='ko'):string{
 if(bytes===null)return translate(language,'측정 중');
 const units=['B/s','KiB/s','MiB/s','GiB/s'];let unit=0;
 while(bytes>=1024&&unit<units.length-1){bytes/=1024;unit++;}
 return `${unit?bytes.toFixed(1):Math.round(bytes)} ${units[unit]}`;
}
