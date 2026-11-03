import test from 'node:test';import assert from 'node:assert/strict';
import {monthGrid} from '../src/shared/calendarFormat.js';
test('month_grid_uses_week_start',()=>{
 const monday=monthGrid('2026-11',1);assert.equal(monday.length,42);assert.equal(monday[0]!.iso,'2026-10-26');assert.equal(monday[6]!.iso,'2026-11-01');assert.equal(monday[41]!.iso,'2026-12-06');
 assert.equal(monthGrid('2026-11',0)[0]!.iso,'2026-11-01');
 assert.equal(monthGrid('2024-02',1).filter(day=>day.inMonth).length,29);
});
