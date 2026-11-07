import {SessionTransport} from '../dbus.js';
import {RustWidgetSession} from './rust.js';
import type {WidgetDataSession,WidgetSessionOptions} from './contracts.js';
export function createWidgetDataSession(options:WidgetSessionOptions):WidgetDataSession {
    return new RustWidgetSession(new SessionTransport(),options);
}
