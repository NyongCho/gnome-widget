import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeJson, encodeFrame, frameLength, parseHeader, parseControl, parseReply,
    ProtocolFailure, type CalendarJobHeader} from '../src/calendar/protocol.js';

const header: CalendarJobHeader = {version: 1, jobId: 'job-1', sourceId: 'source-1', generation: 3,
    context: {month: '2026-11', timeZone: 'Asia/Seoul', weekStart: 1}, now: '2026-11-03T03:00:00Z'};
const data = {...header.context, events: []};
const reply = {version: 1, jobId: header.jobId, sourceId: header.sourceId, generation: 3, ok: true, data};
function rejects(code: string, fn: () => unknown): void {
    assert.throws(fn, error => error instanceof ProtocolFailure && error.code === code);
}
test('JSON framing counts UTF-8 bytes and accepts the exact boundary', () => {
    const value = {text: '한글'}, bytes = new TextEncoder().encode(JSON.stringify(value));
    const framed = encodeFrame(value, bytes.length);
    assert.equal(frameLength(framed.slice(0, 4), bytes.length), bytes.length);
    assert.deepEqual(decodeJson(framed.slice(4)), value);
    rejects('PAYLOAD_TOO_LARGE', () => encodeFrame(value, bytes.length - 1));
});
test('length parsing rejects oversized, zero and truncated frame headers before allocation', () => {
    assert.equal(frameLength(new Uint8Array([0, 8, 0, 0]), 512 * 1024), 512 * 1024);
    rejects('PAYLOAD_TOO_LARGE', () => frameLength(new Uint8Array([255, 255, 255, 255]), 512 * 1024));
    rejects('INVALID_DATA', () => frameLength(new Uint8Array(4), 512 * 1024));
    rejects('INVALID_DATA', () => frameLength(new Uint8Array(3), 512 * 1024));
});
test('malformed UTF-8 and JSON fail without reflecting input', () => {
    rejects('INVALID_DATA', () => decodeJson(new Uint8Array([0xc3, 0x28])));
    rejects('INVALID_DATA', () => decodeJson(new TextEncoder().encode('private-fixture')));
});
test('job header rejects extra URL fields and invalid context', () => {
    assert.deepEqual(parseHeader(header), header);
    rejects('INVALID_DATA', () => parseHeader({...header, url: 'private-fixture'}));
    rejects('INVALID_DATA', () => parseHeader({...header, context: {...header.context, weekStart: 7}}));
    rejects('INVALID_DATA', () => parseHeader({...header, generation: -1}));
});
test('ready and busy control messages are distinct and versioned', () => {
    assert.equal(parseControl({version: 1, state: 'ready'}), 'ready');
    assert.equal(parseControl({version: 1, state: 'busy'}), 'busy');
    rejects('INVALID_DATA', () => parseControl({version: 2, state: 'ready'}));
    rejects('INVALID_DATA', () => parseControl({...reply, state: 'ready'}));
});
test('reply must belong to the exact job, source, generation and calendar context', () => {
    assert.deepEqual(parseReply(reply, header), data);
    for (const change of [{jobId: 'old'}, {sourceId: 'old'}, {generation: 2}, {data: {...data, month: '2026-12'}}]) {
        rejects('INVALID_DATA', () => parseReply({...reply, ...change}, header));
    }
    rejects('INVALID_DATA', () => parseReply({...reply, data: {...data, events: [{title: 'incomplete'}]}}, header));
});
test('worker failures use a closed error enum and cannot smuggle partial data', () => {
    const failure = {version: 1, jobId: header.jobId, sourceId: header.sourceId, generation: 3, ok: false, errorCode: 'EXPANSION_LIMIT'};
    rejects('EXPANSION_LIMIT', () => parseReply(failure, header));
    rejects('INVALID_DATA', () => parseReply({...failure, errorCode: 'secret raw error'}, header));
    rejects('INVALID_DATA', () => parseReply({...failure, data}, header));
});
