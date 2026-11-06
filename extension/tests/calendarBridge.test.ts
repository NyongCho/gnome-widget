import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {CalendarStatusClient,type StatusTransport} from '../src/calendar/statusClient.js';
import {CalendarTokens} from '../src/calendar/statusRegistry.js';
import {parseCalendarSummary,summarizeCalendar,type CalendarSummary} from '../src/shared/calendarSummary.js';
import {Cancellation} from '../src/shared/dataClient.js';
const source=randomUUID(),instance=randomUUID(),context={month:'2026-11',timeZone:'UTC',weekStart:0};
function summary(revision=1,status:'loading'|'ok'='loading',id=instance):CalendarSummary{return{version:1,instanceId:id,revision,sourceId:source,generation:1,context,status,updatedAt:status==='ok'?'2026-11-04T00:00:00Z':null,errorCode:null,hasData:status==='ok',eventCount:status==='ok'?3:0};}
const tick=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
function wire(){let owner:((owner:string|null)=>void)|null=null;const signals=new Map<string,Set<(raw:string)=>void>>(),calls:{owner:string;method:string;args:readonly unknown[];cancel:Cancellation|null;resolve:(reply:readonly unknown[])=>void;reject:(error:Error)=>void}[]=[];const transport:StatusTransport={watchOwner(fn){owner=fn;return()=>{owner=null;};},watchChanges(name,fn){let set=signals.get(name);if(!set){set=new Set();signals.set(name,set);}set.add(fn);return()=>{set!.delete(fn);};},call(owner,method,args,cancel){return new Promise((resolve,reject)=>{calls.push({owner,method,args,cancel,resolve,reject});if(method==='UnwatchCalendar')resolve([]);});}};return{transport,calls,owner(value:string|null){owner?.(value);},signal(owner:string,value:CalendarSummary){for(const fn of signals.get(owner)??[])fn(JSON.stringify(value));},get watches(){return[...signals.values()].reduce((n,s)=>n+s.size,0);}};}
test('summary has a bounded, closed schema and never exposes event titles',()=>{
    const value=summarizeCalendar(instance,2,4,{status:'ok',sourceId:source,updatedAt:'2026-11-04T00:00:00Z',errorCode:null,data:{...context,events:[{uid:'private',occurrenceKey:'private',title:'SECRET TITLE',allDay:false,start:'2026-11-04T01:00:00Z',end:'2026-11-04T02:00:00Z'}]}},context);
    assert.equal(value.eventCount,1);assert.ok(!JSON.stringify(value).includes('SECRET'));assert.deepEqual(parseCalendarSummary(JSON.stringify(value)),value);
    for(const raw of [JSON.stringify({...value,url:'secret'}),JSON.stringify({...value,errorCode:'https://secret'}),JSON.stringify({...value,hasData:false}),JSON.stringify({...value,generation:-1}),' '.repeat(16385)])assert.throws(()=>parseCalendarSummary(raw));
});
test('foreign_watch_token, per-sender/total caps, sender death and disable release demand',()=>{
    const counts:number[]=[],tokens=new CalendarTokens(randomUUID,n=>counts.push(n));const first=tokens.begin(':1.1').commit()!;assert.equal(tokens.size,1);tokens.unwatch(':1.2',first);assert.equal(tokens.size,1);
    for(let i=0;i<7;i++)tokens.begin(':1.1').commit();assert.throws(()=>tokens.begin(':1.1'),/RATE_LIMITED/);for(let i=2;i<=16;i++)for(let j=0;j<8;j++)tokens.begin(`:1.${i}`).commit();assert.equal(tokens.size,128);assert.throws(()=>tokens.begin(':1.99'),/RATE_LIMITED/);
    tokens.senderGone(':1.1');assert.equal(tokens.size,120);tokens.destroy();assert.equal(tokens.size,0);assert.equal(counts.at(-1),0);
});
test('sender disappearing during asynchronous registration cannot leave a watch token',()=>{
    const book=new CalendarTokens(randomUUID,()=>{}),pending=book.begin(':1.1');book.senderGone(':1.1');assert.equal(pending.commit(),null);assert.equal(book.size,0);
    const again=book.begin(':1.2');again.cancel();assert.equal(again.commit(),null);book.destroy();assert.throws(()=>book.begin(':1.3'));
});
test('newer_signal_beats_watch_snapshot and completion_during_watch_setup retain newest revision',async()=>{
    const w=wire(),states:CalendarSummary[]=[],client=new CalendarStatusClient(w.transport,s=>states.push(s),()=>{});client.start();w.owner(':1.1');assert.equal(w.watches,1);const watch=w.calls[0]!;assert.equal(watch.cancel,null);w.signal(':1.1',summary(2,'ok'));watch.resolve([randomUUID(),JSON.stringify(summary(1))]);await tick();assert.equal(states.at(-1)?.status,'ok');assert.equal(states.at(-1)?.revision,2);
    w.signal(':1.1',summary(1));assert.equal(states.length,1);w.signal(':1.1',{...summary(3,'ok'),generation:0});assert.equal(states.length,1);client.destroy();assert.equal(w.watches,0);
});
test('close_before_watch_reply releases the late token on its original owner without canceling the reply',async()=>{
    const w=wire(),states:CalendarSummary[]=[],client=new CalendarStatusClient(w.transport,s=>states.push(s),()=>{});client.start();w.owner(':1.1');const call=w.calls[0]!,token=randomUUID();client.destroy();assert.equal(call.cancel,null);call.resolve([token,JSON.stringify(summary())]);await tick();assert.equal(states.length,0);assert.deepEqual(w.calls.at(-1)?.args,[token]);assert.equal(w.calls.at(-1)?.owner,':1.1');assert.equal(w.calls.at(-1)?.method,'UnwatchCalendar');
});
test('owner_change_before_watch_reply and reenable_same_owner_new_instance cannot update new UI or remove its token',async()=>{
    for(const sameOwner of [false,true]){const w=wire(),states:CalendarSummary[]=[],client=new CalendarStatusClient(w.transport,s=>states.push(s),()=>{});client.start();w.owner(':1.1');const old=w.calls[0]!,oldToken=randomUUID(),nextOwner=sameOwner?':1.1':':1.2',newInstance=randomUUID(),newToken=randomUUID();w.owner(null);w.owner(nextOwner);const current=w.calls[1]!;current.resolve([newToken,JSON.stringify(summary(1,'ok',newInstance))]);await tick();old.resolve([oldToken,JSON.stringify(summary(9,'loading'))]);await tick();w.signal(nextOwner,summary(10));assert.equal(states.length,1);assert.equal(states[0]?.instanceId,newInstance);assert.deepEqual(w.calls.at(-1)?.args,[oldToken]);assert.equal(w.calls.at(-1)?.owner,':1.1');client.destroy();assert.deepEqual(w.calls.at(-1)?.args,[newToken]);}
});
test('invalid initial summary still releases a valid allocated token; refresh targets unique owner',async()=>{
    const w=wire(),client=new CalendarStatusClient(w.transport,()=>{},()=>{});client.start();w.owner(':1.1');const token=randomUUID();w.calls[0]!.resolve([token,'invalid']);await tick();assert.equal(w.calls.at(-1)?.method,'UnwatchCalendar');
    const cancel=new Cancellation(),refresh=client.refresh(cancel);assert.equal(w.calls.at(-1)?.owner,':1.1');assert.equal(w.calls.at(-1)?.cancel,cancel);w.calls.at(-1)!.resolve([]);await refresh;client.destroy();
});
test('summary rejects state combinations that the provider DTO also rejects',()=>{
 for(const value of [{...summary(1,'ok'),errorCode:'NETWORK_ERROR'},{...summary(),status:'unconfigured',updatedAt:'2026-11-04T00:00:00Z'},{...summary(1,'ok'),status:'stale',errorCode:null},{...summary(),status:'unavailable',errorCode:null}])assert.throws(()=>parseCalendarSummary(JSON.stringify(value)));
});
test('summary context compares fields, not JSON property order, on completion',async()=>{
 const w=wire(),states:CalendarSummary[]=[],client=new CalendarStatusClient(w.transport,s=>states.push(s),()=>{});client.start();w.owner(':1.1');w.calls[0]!.resolve([randomUUID(),JSON.stringify(summary())]);await tick();
 w.signal(':1.1',{...summary(2,'ok'),context:{weekStart:0,timeZone:'UTC',month:'2026-11'}});assert.equal(states.at(-1)?.status,'ok');client.destroy();
});
