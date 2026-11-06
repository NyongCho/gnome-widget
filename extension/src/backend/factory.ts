import {SessionTransport} from '../dbus.js';
import {createLocalWidgetSession} from '../data/runtime.js';
import {RustWidgetSession} from './rust.js';
import type {WidgetDataSession,WidgetSessionOptions} from './contracts.js';
declare const __LIQUID_BACKEND__:'rust'|'gjs';
export function createWidgetDataSession(options:WidgetSessionOptions):WidgetDataSession {
    if(typeof __LIQUID_BACKEND__!=='undefined'&&__LIQUID_BACKEND__==='gjs')
        return createLocalWidgetSession(options);
    return new RustWidgetSession(new SessionTransport(),options);
}
