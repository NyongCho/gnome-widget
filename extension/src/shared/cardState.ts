import {translate,type Language,type Message} from './i18n.js';
import type {ProviderState} from '../types.js';
export interface CardPresentation<T>{kind:'disconnected'|'unconfigured'|'loading'|'ready'|'stale'|'unavailable';data:T|null;updatedAt:string|null;message:string}
const errors:Record<string,Message>={NETWORK_ERROR:'연결을 확인해 주세요',INVALID_DATA:'데이터를 읽을 수 없어요',PAYLOAD_TOO_LARGE:'데이터가 너무 커요',EXPANSION_LIMIT:'일정이 너무 많아요',UNSUPPORTED_CALENDAR:'지원하지 않는 일정 형식',UNKNOWN_TIME_ZONE:'시간대를 확인해 주세요',KEYRING_LOCKED:'키링 잠금을 해제해 주세요',SECRET_DELETION_FAILED:'연결 정보 삭제를 다시 시도해 주세요',AUTH_ERROR:'캘린더 연결을 확인해 주세요',RATE_LIMITED:'잠시 후 다시 시도합니다',NO_PLAYER:'재생 중인 음악 없음',NO_INTERFACE:'네트워크를 확인해 주세요',SERVICE_UNAVAILABLE:'데이터를 기다리는 중',INTERNAL_ERROR:'다시 연결하는 중'};
export function cardState<T>(state:ProviderState<T>,connected:boolean,language:Language='ko'):CardPresentation<T>{
    if(!connected)return{kind:state.data===null?'disconnected':'stale',data:state.data,updatedAt:state.updatedAt,message:translate(language,state.data===null?'데이터 서비스 연결 대기':'연결 끊김 · 마지막 데이터')};
    if(state.status==='unconfigured')return{kind:'unconfigured',data:null,updatedAt:null,message:translate(language,'설정이 필요해요')};
    if(state.status==='loading')return{kind:state.data===null?'loading':'stale',data:state.data,updatedAt:state.updatedAt,message:translate(language,'업데이트 중…')};
    if(state.status==='ok' && state.data!==null)return{kind:'ready',data:state.data,updatedAt:state.updatedAt,message:''};
    return{kind:state.data===null?'unavailable':'stale',data:state.data,updatedAt:state.updatedAt,message:translate(language,errors[state.errorCode??'']??'데이터를 사용할 수 없어요')};
}
