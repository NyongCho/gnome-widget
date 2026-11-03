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
