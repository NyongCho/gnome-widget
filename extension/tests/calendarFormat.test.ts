import test from 'node:test';import assert from 'node:assert/strict';
import {monthGrid} from '../src/shared/calendarFormat.js';
test('month_grid_uses_week_start',()=>{
 const monday=monthGrid('2026-11',1);assert.equal(monday.length,42);assert.equal(monday[0]!.iso,'2026-10-26');assert.equal(monday[6]!.iso,'2026-11-01');assert.equal(monday[41]!.iso,'2026-12-06');
 assert.equal(monthGrid('2026-11',0)[0]!.iso,'2026-11-01');
 assert.equal(monthGrid('2024-02',1).filter(day=>day.inMonth).length,29);
});

test('event dots cover local days and exclude the exclusive all-day end',async()=>{
 const {eventDays}=await import('../src/shared/calendarFormat.js');
 const dates=eventDays([
  {uid:'all-day',occurrenceKey:'1',title:'',start:'2026-11-04',end:'2026-11-06',allDay:true},
  {uid:'timed',occurrenceKey:'2',title:'',start:'2026-11-06T23:30:00+09:00',end:'2026-11-07T00:30:00+09:00',allDay:false},
  {uid:'midnight',occurrenceKey:'3',title:'',start:'2026-11-09T23:00:00+09:00',end:'2026-11-10T00:00:00+09:00',allDay:false},
 ],monthGrid('2026-11',1),'Asia/Seoul');
 assert.deepEqual([...dates].sort(),['2026-11-04','2026-11-05','2026-11-06','2026-11-07','2026-11-09']);
});
