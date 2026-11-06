import {translate,type Language} from './i18n.js';
import type {ProviderMap,ProviderState,Settings} from '../types.js';
import {cardState} from './cardState.js';
function connectionStatus(settings:Settings,state:ProviderState<unknown>,connected:boolean,count:number,language:Language):string{
    if(settings.calendarSecretDeletionPending)return translate(language,'연결 정보 삭제가 남아 있어요. 키링을 해제하고 다시 삭제해 주세요.');
    if(!settings.calendarEnabled)return translate(language,'연결하지 않음');
    if(!connected)return translate(language,'연결 정보 저장됨 · 데이터 서비스 연결 대기');
    const view=cardState(state,true,language);
    if(view.kind==='ready')return translate(language,'동기화 완료 · 표시 범위의 일정 {count}개',{count});
    if(view.kind==='loading'||view.kind==='unconfigured')return translate(language,'일정을 불러오는 중…');
    if(state.status==='loading')return translate(language,'일정 갱신 중 · 마지막 동기화 데이터 표시');
    return view.data!==null?translate(language,'{message} · 마지막 동기화 데이터 표시',{message:view.message}):view.message;
}

export function calendarConnectionStatus(settings:Settings,state:ProviderMap['calendar'],connected:boolean,language:Language='ko'):string{
    return connectionStatus(settings,state,connected,state.data?.events.length??0,language);
}
export function calendarSummaryStatus(settings:Settings,summary:import('./calendarSummary.js').CalendarSummary|null,origin:import('./calendarSummary.js').CalendarOrigin,language:Language='ko'):string{
    if(settings.calendarSecretDeletionPending)return translate(language,'연결 정보 삭제가 남아 있어요. 키링을 해제하고 다시 삭제해 주세요.');
    if(!settings.calendarEnabled)return translate(language,'연결하지 않음');
    if(!summary||origin==='unavailable')return translate(language,'연결 정보 저장됨 · 상태 확인 중');
    const state={...summary,data:summary.hasData?{}:null};
    if(origin!=='preview')return connectionStatus(settings,state,true,summary.eventCount,language);
    if(summary.status==='ok')return translate(language,'연결 확인 완료 · 일정 {count}개',{count:summary.eventCount});
    if(summary.status==='loading')return translate(language,summary.hasData?'연결 확인 중 · 마지막 데이터 표시':'연결을 확인하는 중…');
    const view=cardState(state,true,language);
    return summary.hasData?translate(language,'{message} · 마지막 확인 데이터 표시',{message:view.message}):view.message;
}
