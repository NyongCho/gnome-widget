import type {ProviderMap,Settings} from '../types.js';
import {cardState} from './cardState.js';
export function calendarConnectionStatus(settings:Settings,state:ProviderMap['calendar'],connected:boolean):string{
    if(settings.calendarSecretDeletionPending)return '연결 정보 삭제가 남아 있어요. 키링을 해제하고 다시 삭제해 주세요.';
    if(!settings.calendarEnabled)return '연결하지 않음';
    if(!connected)return '연결 정보 저장됨 · 데이터 서비스 연결 대기';
    const view=cardState(state,true);
    if(view.kind==='ready')return `동기화 완료 · 표시 범위의 일정 ${state.data?.events.length??0}개`;
    if(view.kind==='loading'||view.kind==='unconfigured')return '일정을 불러오는 중…';
    if(state.status==='loading')return '일정 갱신 중 · 마지막 동기화 데이터 표시';
    return `${view.message}${view.data!==null?' · 마지막 동기화 데이터 표시':''}`;
}
