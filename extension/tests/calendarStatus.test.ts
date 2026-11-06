import test from 'node:test';import assert from 'node:assert/strict';
import * as presentation from '../src/shared/calendarStatus.js';
import type {ProviderMap,Settings} from '../src/types.js';
const settings:Settings={calendarEnabled:true,calendarSecretDeletionPending:false,weatherLocation:null,networkInterface:'auto'};
const state:ProviderMap['calendar']={status:'unavailable',sourceId:'fixture',updatedAt:null,data:null,errorCode:'INVALID_DATA'};
test('calendar preferences report real failures and completion after URL storage',()=>{
 assert.match(presentation.calendarConnectionStatus(settings,state,true),/읽을 수 없/);
 const ready:ProviderMap['calendar']={...state,status:'ok',errorCode:null,updatedAt:'2026-11-04T00:00:00Z',data:{month:'2026-11',timeZone:'Asia/Seoul',weekStart:1,events:[]}};
 assert.match(presentation.calendarConnectionStatus(settings,ready,true),/동기화 완료/);
 assert.match(presentation.calendarConnectionStatus(settings,{...ready,status:'loading'},true),/갱신 중/);
 assert.match(presentation.calendarConnectionStatus({...settings,calendarSecretDeletionPending:true},ready,true),/삭제/);
 assert.match(presentation.calendarConnectionStatus(settings,ready,false),/연결 대기/);
});
test('summary status distinguishes settings preview from widget synchronization in both languages',()=>{
 const summary={version:1 as const,instanceId:'00000000-0000-0000-0000-000000000000',revision:1,sourceId:'fixture',generation:1,context:{month:'2026-11',timeZone:'UTC',weekStart:0},status:'ok' as const,updatedAt:'2026-11-04T00:00:00Z',errorCode:null,hasData:true,eventCount:7};
 assert.match(presentation.calendarSummaryStatus(settings,summary,'shell','ko'),/동기화 완료.*7/);
 assert.match(presentation.calendarSummaryStatus(settings,summary,'preview','ko'),/연결 확인 완료.*7/);
 assert.match(presentation.calendarSummaryStatus(settings,summary,'preview','en'),/Connection verified.*7/);
 assert.match(presentation.calendarSummaryStatus(settings,{...summary,status:'stale',errorCode:'NETWORK_ERROR'},'preview','en'),/last/);
});
