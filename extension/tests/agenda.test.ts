import test from 'node:test';
import assert from 'node:assert/strict';
import {selectAgenda} from '../src/shared/agenda.js';
import type {CalendarEvent} from '../src/types.js';
const event=(uid:string,start:string,end:string,allDay=false):CalendarEvent=>({uid,occurrenceKey:uid,title:uid,start,end,allDay});
const now=Date.parse('2026-11-04T09:30:00+09:00');
test('agenda_excludes_ended_and_caps_at_three',()=>{
 const values=[event('next-2','2026-11-04T12:00:00+09:00','2026-11-04T13:00:00+09:00'),event('ended','2026-11-04T08:00:00+09:00','2026-11-04T09:30:00+09:00'),event('ongoing','2026-11-04T09:00:00+09:00','2026-11-04T10:00:00+09:00'),event('next-1','2026-11-04T11:00:00+09:00','2026-11-04T11:30:00+09:00'),event('next-3','2026-11-04T14:00:00+09:00','2026-11-04T15:00:00+09:00')];
 assert.deepEqual(selectAgenda(values,now,'2026-11-04').map(e=>e.uid),['ongoing','next-1','next-2']);
});
test('all_day_is_active_until_exclusive_end',()=>{
 const values=[event('yesterday','2026-11-03','2026-11-04',true),event('today','2026-11-04','2026-11-05',true)];
 assert.deepEqual(selectAgenda(values,now,'2026-11-04').map(e=>e.uid),['today']);
 assert.equal(selectAgenda(values,now,'2026-11-05').length,0);
});
test('equal starts have stable uid and occurrence ordering without mutating input',()=>{
 const values=['b','a'].map(id=>event(id,'2026-11-04T11:00:00+09:00','2026-11-04T12:00:00+09:00'));
 assert.deepEqual(selectAgenda(values,now,'2026-11-04').map(e=>e.uid),['a','b']);assert.equal(values[0]!.uid,'b');
});
test('agenda applies its own 30-day display-zone horizon and keeps ongoing events',()=>{
 const values=[event('outside','2026-12-04','2026-12-05',true),event('boundary','2026-12-01T00:00:00+09:00','2026-12-01T01:00:00+09:00'),event('inside','2026-11-30T23:00:00+09:00','2026-12-01T01:00:00+09:00'),event('ongoing','2026-10-01','2026-11-03',true)];
 assert.deepEqual(selectAgenda(values,Date.parse('2026-11-01T09:00:00+09:00'),'2026-11-01','Asia/Seoul').map(e=>e.uid),['ongoing','inside']);
});
test('mixed all-day and timed starts sort in the display zone',()=>{
 const values=[event('one-am','2026-11-04T16:00:00Z','2026-11-04T17:00:00Z'),event('all-day','2026-11-05','2026-11-06',true)];
 assert.deepEqual(selectAgenda(values,now,'2026-11-04','Asia/Seoul').map(e=>e.uid),['all-day','one-am']);
});
test('agenda captions identify dates for timed and all-day events',async()=>{
 const {formatAgendaWhen}=await import('../src/shared/agenda.js');
 assert.match(formatAgendaWhen(event('a','2026-11-04T16:00:00Z','2026-11-04T17:00:00Z'),'Asia/Seoul','en-US',false),/Nov 5.*01:00/);
 assert.match(formatAgendaWhen(event('b','2026-11-12','2026-11-13',true),'Asia/Seoul','en-US',false),/Nov 12.*종일/);
});
