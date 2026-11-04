import test from 'node:test';import assert from 'node:assert/strict';
import {millisecondsToNextMinute,clockValues} from '../src/shared/clockValues.js';
import * as clockHelpers from '../src/shared/clockValues.js';
test('clock_values_follow_minute_boundary',()=>{
 assert.equal(millisecondsToNextMinute(Date.parse('2026-11-03T09:59:59.250+09:00')),750);
 assert.equal(millisecondsToNextMinute(Date.parse('2026-11-03T10:00:00+09:00')),60000);
});
test('clock faces use local wall time for hands and separate localized AM/PM from digits',()=>{
 assert.equal(typeof clockHelpers.clockFaceValues,'function','clock faces need timezone-aware display values');
 const now=Date.parse('2026-11-03T18:15:30Z');
 const ko=clockHelpers.clockFaceValues(now,'Asia/Seoul',true,'ko-KR');
 assert.equal(ko.digits,'03:15');assert.equal(ko.dayPeriod,'오전');
 assert.equal(ko.hourAngle,97.75);assert.equal(ko.minuteAngle,93);assert.equal(ko.secondAngle,180);
 assert.match(ko.date,/11월 4일/);assert.match(ko.date,/수요일/);
 const kathmandu=clockHelpers.clockFaceValues(now,'Asia/Kathmandu',false,'en-US');
 assert.equal(kathmandu.digits,'00:00');assert.equal(kathmandu.dayPeriod,'');
 assert.equal(kathmandu.hourAngle,.25);assert.equal(kathmandu.minuteAngle,3);
 const noon=clockHelpers.clockFaceValues(Date.parse('2026-11-04T03:00:00Z'),'Asia/Seoul',true,'en-US');
 assert.equal(noon.digits,'12:00');assert.equal(noon.dayPeriod,'PM');assert.match(noon.date,/Wednesday/);
});
test('analog updates align with the next wall-clock second',()=>{
 assert.equal(typeof clockHelpers.millisecondsToNextSecond,'function','analog clocks need a second boundary');
 assert.equal(clockHelpers.millisecondsToNextSecond(1250),750);
 assert.equal(clockHelpers.millisecondsToNextSecond(2000),1000);
 assert.equal(clockHelpers.millisecondsToNextSecond(-250),250);
 assert.equal(clockHelpers.millisecondsToNextSecond(1999.9),1);
 assert.equal(clockHelpers.millisecondsToNextSecond(-.1),1);
});
test('clock follows midnight, timezone and 12/24 hour preferences',()=>{
 const now=Date.parse('2026-11-03T15:00:00Z');
 const seoul=clockValues(now,'Asia/Seoul',false,'ko-KR');
 assert.equal(seoul.today,'2026-11-04');assert.equal(seoul.time,'00:00');
 assert.equal(clockValues(now,'UTC',false,'en-GB').today,'2026-11-03');
 assert.match(clockValues(now,'America/New_York',true,'en-US').time,/10:00/);
 assert.match(clockValues(now,'America/New_York',true,'en-US').time,/AM/);
});
