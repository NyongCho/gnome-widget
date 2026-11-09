import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { createRequire } from 'node:module';
import type { FormatsPlugin } from 'ajv-formats';
const addFormats: FormatsPlugin = createRequire(import.meta.url)('ajv-formats');
import { format } from 'prettier';
import * as generated from '../generated/validators.js';

const fixture = (name: string) =>
    JSON.parse(
        readFileSync(
            new URL(`../../tests/fixtures/protocol/${name}.json`, import.meta.url),
            'utf8',
        ),
    );
const snapshot = fixture('snapshot-valid'),
    settings = fixture('settings-valid');
// Original generator options: compare accepted data, not Ajv's internal function names.
const baseline = new Ajv2020({ code: { source: true, esm: true }, strict: true, allErrors: false });
addFormats(baseline);
const schemas = Object.fromEntries(
    ['snapshot', 'settings', 'calendar-worker', 'data-config', 'calendar-status'].map((name) => {
        const schema = JSON.parse(
            readFileSync(new URL(`../../protocol/${name}.schema.json`, import.meta.url), 'utf8'),
        );
        baseline.addSchema(schema);
        return [name, schema.$id];
    }),
);
const refs: Record<string, string> = {
    snapshot: schemas.snapshot,
    settings: schemas.settings,
    calendarContext: `${schemas.snapshot}#/$defs/CalendarContext`,
    weatherLocation: `${schemas.settings}#/$defs/WeatherLocationInput`,
    locationSearchResults: `${schemas.settings}#/$defs/LocationSearchResults`,
    dataConfig: schemas['data-config'],
    calendarSummary: schemas['calendar-status'],
};
for (const name of ['Calendar', 'Weather', 'System', 'Network', 'Media'])
    refs[name.toLowerCase()] = `${schemas.snapshot}#/$defs/${name}State`;
for (const name of ['Header', 'Control', 'Reply'])
    refs[`worker${name}`] = `${schemas['calendar-worker']}#/$defs/${name}`;
const context = { month: '2026-11', timeZone: 'Asia/Seoul', weekStart: 1 };
const location = {
    id: 'seoul',
    label: '서울',
    latitude: 37.5,
    longitude: 127,
    timeZone: 'Asia/Seoul',
};
const header = {
    version: 1,
    jobId: 'job',
    sourceId: 'source',
    generation: 1,
    context,
    now: '2026-11-03T00:00:00Z',
};
const uuid = '12345678-1234-4234-8234-123456789012';
const seeds: Record<string, unknown> = {
    snapshot,
    settings,
    calendarContext: context,
    weatherLocation: location,
    locationSearchResults: [location],
    calendar: snapshot.calendar,
    weather: snapshot.weather,
    system: snapshot.system,
    network: snapshot.network,
    media: {
        status: 'ok',
        sourceId: null,
        updatedAt: header.now,
        errorCode: null,
        data: {
            player: 'fixture',
            status: 'playing',
            title: '한글 🎵',
            artist: 'fixture',
            artUri: 'file:///fixture/cover.png',
        },
    },
    workerHeader: header,
    workerControl: { version: 1, state: 'ready' },
    workerReply: {
        version: 1,
        jobId: 'job',
        sourceId: 'source',
        generation: 1,
        ok: true,
        data: snapshot.calendar.data,
    },
    dataConfig: {
        schemaVersion: 1,
        revision: uuid,
        calendar: { sourceId: uuid, enabled: true, deletionPending: false },
        weather: { sourceId: uuid, location },
        networkInterface: 'auto',
    },
    calendarSummary: {
        version: 1,
        instanceId: uuid,
        revision: 1,
        generation: 1,
        context,
        hasData: true,
        eventCount: 1,
        sourceId: 'source',
        status: 'ok',
        updatedAt: header.now,
        errorCode: null,
    },
};

// Visit each nested field to exercise refs, optional fields, extra keys and type boundaries.
function* mutations(value: unknown): Generator<unknown> {
    yield* [null, undefined, true, false, 0, -1, 1.5, 4294967296, '', 'x', [], {}];
    if (Array.isArray(value)) {
        yield [];
        if (value.length)
            for (const changed of mutations(value[0])) yield [changed, ...value.slice(1)];
    } else if (value && typeof value === 'object') {
        yield { ...value, unexpected: 'extra' };
        for (const [key, item] of Object.entries(value)) {
            const removed = { ...value } as Record<string, unknown>;
            delete removed[key];
            yield removed;
            for (const changed of mutations(item)) yield { ...value, [key]: changed };
        }
    }
}
for (const [name, seed] of Object.entries(seeds))
    test(`${name}: factored validators preserve original accepted data`, () => {
        const old = baseline.getSchema(refs[name]!)!;
        const current = generated[name as keyof typeof generated];
        assert.equal(old(seed), true, `${name} needs a valid seed`);
        assert.equal(current(seed), true);
        for (const value of mutations(seed))
            assert.equal(current(value), old(value), `${name}: ${JSON.stringify(value)}`);
    });
test('Unicode, format and numeric boundary checks remain strict', () => {
    for (const [name, value, expected] of [
        ['weatherLocation', { ...location, label: '😀'.repeat(512) }, true],
        ['weatherLocation', { ...location, label: '😀'.repeat(513) }, false],
        ['weatherLocation', { ...location, latitude: 90 }, true],
        ['weatherLocation', { ...location, latitude: 90.01 }, false],
        ['workerHeader', { ...header, now: '2026-02-30T00:00:00Z' }, false],
        ['workerHeader', { ...header, now: '2026-11-03' }, false],
        ['workerHeader', { ...header, now: '2026-11-03T09:00:00+09:00' }, true],
        ['dataConfig', { ...(seeds.dataConfig as object), revision: 'not-a-uuid' }, false],
        ['dataConfig', { ...(seeds.dataConfig as object), networkInterface: 'eth/0' }, false],
        [
            'weather',
            {
                ...snapshot.weather,
                data: { ...snapshot.weather.data, attributionUrl: 'not a URI' },
            },
            false,
        ],
    ] as const) {
        assert.equal(baseline.getSchema(refs[name]!)!(value), expected);
        assert.equal(generated[name](value), expected);
    }
});
test('generated validation stays factored instead of inlining whole schemas', async () => {
    const dir = new URL('../generated/validators/', import.meta.url);
    for (const name of readdirSync(dir).filter((name) => name.endsWith('.js'))) {
        const code = await format(readFileSync(new URL(name, dir), 'utf8'), {
            parser: 'babel',
            tabWidth: 4,
            printWidth: 100,
            singleQuote: true,
        });
        // Snapshot is used only by the personal transport and covers all five providers.
        const budget = name === 'snapshot.js' ? 600_000 : 150_000;
        assert.ok(Buffer.byteLength(code) < budget, `${name} exceeds readable module budget`);
    }
});
