import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSettings, parseSnapshot } from '../src/shared/validation.js';
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../tests/fixtures/protocol/${name}.json`, import.meta.url), 'utf8'));
const snapshot = fixture('snapshot-valid');
const settings = fixture('settings-valid');
test('shared fixtures round trip with independent provider states', () => {
    assert.deepEqual(parseSnapshot(JSON.stringify(snapshot)), snapshot);
    assert.deepEqual(parseSettings(JSON.stringify(settings)), settings);
});
for (const invalid of fixture('invalid-cases')) {
    test(`reject ${invalid.name}`, () => {
        const data = structuredClone(invalid.kind === 'settings' ? settings : snapshot);
        let target = data;
        for (const key of invalid.path.slice(0, -1)) target = target[key];
        target[invalid.path.at(-1)] = invalid.value;
        assert.throws(() => (invalid.kind === 'settings' ? parseSettings : parseSnapshot)(JSON.stringify(data)));
    });
}
test('UTF-8 payload budget is measured in bytes', () => {
    const data = structuredClone(snapshot);
    const event = { ...data.calendar.data.events[0], title: '한'.repeat(1300) };
    data.calendar.data.events = Array.from({length: 150}, () => event);
    const raw = JSON.stringify(data);
    assert.ok(raw.length < 512 * 1024);
    assert.throws(() => parseSnapshot(raw));
});

test('provider signals and setting inputs use the shared schemas', async () => {
    const { parseProviderState, parseCalendarContext, parseWeatherLocation, parseLocationSearchResults } = await import('../src/shared/validation.js');
    for (const name of ['calendar','weather','system','network','media'] as const) assert.deepEqual(parseProviderState(name, JSON.stringify(snapshot[name])), snapshot[name]);
    assert.throws(() => parseProviderState('system', JSON.stringify(snapshot.weather)));
    assert.throws(() => parseProviderState('calendar', ' '.repeat(512*1024+1)));
    assert.equal(parseCalendarContext('{"month":"2026-11","timeZone":"Asia/Seoul","weekStart":1}').month, '2026-11');
    assert.equal(parseWeatherLocation('null'), null);
    assert.deepEqual(parseLocationSearchResults('[]'), []);
});
test('errors do not echo invalid private input', () => {
    assert.throws(() => parseSnapshot('https://calendar.google.com/private-secret'), {name:'ValidationError',message:'Invalid protocol payload'});
});
