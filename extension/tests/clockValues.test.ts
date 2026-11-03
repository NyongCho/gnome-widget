import test from 'node:test';import assert from 'node:assert/strict';
import {millisecondsToNextMinute,clockValues} from '../src/shared/clockValues.js';
test('clock_values_follow_minute_boundary',()=>{
 assert.equal(millisecondsToNextMinute(Date.parse('2026-11-03T09:59:59.250+09:00')),750);
 assert.equal(millisecondsToNextMinute(Date.parse('2026-11-03T10:00:00+09:00')),60000);
});
test('clock follows midnight, timezone and 12/24 hour preferences',()=>{
 const now=Date.parse('2026-11-03T15:00:00Z');
 const seoul=clockValues(now,'Asia/Seoul',false,'ko-KR');
 assert.equal(seoul.today,'2026-11-04');assert.equal(seoul.time,'00:00');
 assert.equal(clockValues(now,'UTC',false,'en-GB').today,'2026-11-03');
 assert.match(clockValues(now,'America/New_York',true,'en-US').time,/10:00/);
 assert.match(clockValues(now,'America/New_York',true,'en-US').time,/AM/);
});
