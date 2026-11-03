import test from 'node:test';import assert from 'node:assert/strict';
import {weatherView} from '../src/shared/weatherFormat.js';import type {WeatherData} from '../src/types.js';
const fixture:WeatherData={location:'서울',timeZone:'Asia/Seoul',current:{temperatureC:null,code:3},hourly:[{at:'2026-11-04T15:00:00Z',temperatureC:0,precipitationProbability:null},{at:'2026-11-04T16:00:00Z',temperatureC:null,precipitationProbability:0}],attributionUrl:'https://open-meteo.com/'};
test('weather hours use selected timezone across midnight and preserve missing values',()=>{
 const view=weatherView(fixture,'en-US',false)!;assert.ok(view);assert.equal(view.temperature,'—°');assert.equal(view.description,'흐림');assert.equal(view.hours[0]!.time,'00');assert.equal(view.hours[0]!.temperature,'0°');assert.equal(view.hours[0]!.rain,'—');assert.equal(view.hours[1]!.temperature,'—°');assert.equal(view.hours[1]!.rain,'0%');
});
test('invalid timezone cannot crash the shell and unknown weather is not reported clear',()=>{
 assert.equal(weatherView({...fixture,timeZone:'Not/AZone'},'en-US',false),null);
 const view=weatherView({...fixture,current:{temperatureC:12,code:null}},'ko-KR',false);assert.ok(view);assert.equal(view.description,'날씨 정보 없음');
});
