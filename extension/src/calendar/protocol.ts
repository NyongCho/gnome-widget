import {workerHeader, workerControl, workerReply} from '../../generated/validators.js';
import type {CalendarContext, CalendarData} from '../types.js';

export const CONTROL_LIMIT = 16 * 1024;
export const INPUT_LIMIT = 5 * 1024 * 1024;
export const REPLY_LIMIT = 512 * 1024;
export interface CalendarJobHeader {
    version: 1; jobId: string; sourceId: string; generation: number;
    context: CalendarContext; now: string;
}
export interface CalendarJob {header: CalendarJobHeader; ics: Uint8Array}
export type WorkerErrorCode = 'INVALID_DATA' | 'UNSUPPORTED_CALENDAR' | 'UNKNOWN_TIME_ZONE' |
    'PAYLOAD_TOO_LARGE' | 'EXPANSION_LIMIT' | 'SERVICE_UNAVAILABLE';
export class ProtocolFailure extends Error {
    constructor(readonly code: WorkerErrorCode) {super(code); this.name = 'ProtocolFailure';}
}
export function frameLength(prefix: Uint8Array, limit: number): number {
    if (prefix.byteLength !== 4) throw new ProtocolFailure('INVALID_DATA');
    const size = new DataView(prefix.buffer, prefix.byteOffset, 4).getUint32(0, false);
    if (size > limit) throw new ProtocolFailure('PAYLOAD_TOO_LARGE');
    if (!size) throw new ProtocolFailure('INVALID_DATA');
    return size;
}
export function encodeFrame(value: unknown, limit: number): Uint8Array {
    const body = new TextEncoder().encode(JSON.stringify(value));
    if (body.byteLength > limit) throw new ProtocolFailure('PAYLOAD_TOO_LARGE');
    const frame = new Uint8Array(body.byteLength + 4);
    new DataView(frame.buffer).setUint32(0, body.byteLength, false);
    frame.set(body, 4);
    return frame;
}
export function decodeJson(bytes: Uint8Array): unknown {
    try {return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)) as unknown;}
    catch {throw new ProtocolFailure('INVALID_DATA');}
}
export function parseHeader(value: unknown): CalendarJobHeader {
    if (!workerHeader(value)) throw new ProtocolFailure('INVALID_DATA');
    return value as CalendarJobHeader;
}
export function parseControl(value: unknown): 'ready' | 'busy' {
    if (!workerControl(value)) throw new ProtocolFailure('INVALID_DATA');
    return (value as {state: 'ready' | 'busy'}).state;
}
export function parseReply(value: unknown, expected: CalendarJobHeader): CalendarData {
    if (!workerReply(value)) throw new ProtocolFailure('INVALID_DATA');
    const reply = value as {version: 1; jobId: string; sourceId: string; generation: number} &
        ({ok: true; data: CalendarData} | {ok: false; errorCode: WorkerErrorCode});
    if (reply.jobId !== expected.jobId || reply.sourceId !== expected.sourceId || reply.generation !== expected.generation)
        throw new ProtocolFailure('INVALID_DATA');
    if (!reply.ok) throw new ProtocolFailure(reply.errorCode);
    const context = reply.data;
    if (context.month !== expected.context.month || context.timeZone !== expected.context.timeZone || context.weekStart !== expected.context.weekStart)
        throw new ProtocolFailure('INVALID_DATA');
    return reply.data;
}
