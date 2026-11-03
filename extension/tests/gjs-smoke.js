// Execute the actual bundle in GJS, independently of Node and the Shell UI.
import Gio from 'gi://Gio';
import { parseSnapshot, parseProviderState, parseSettings, parseCalendarContext, parseWeatherLocation } from '../dist/shared/validation.js';
const read = path => new TextDecoder().decode(Gio.File.new_for_path(path).load_contents(null)[1]);
const snapshot = parseSnapshot(read('tests/fixtures/protocol/snapshot-valid.json'));
if (snapshot.calendar.data.events[0].title !== '오늘 일정') throw new Error('UTF-8 round trip');
parseProviderState('calendar', JSON.stringify(snapshot.calendar));
parseSettings(read('tests/fixtures/protocol/settings-valid.json'));
parseCalendarContext('{"month":"2026-11","timeZone":"Asia/Seoul","weekStart":1}');
if (parseWeatherLocation('null') !== null) throw new Error('null location');
let rejected = false;
try { parseSnapshot('{"schemaVersion":99}'); } catch { rejected = true; }
if (!rejected) throw new Error('invalid snapshot accepted');
// Parse the real introspection XML with GIO's D-Bus parser.
const node = Gio.DBusNodeInfo.new_for_xml(read('protocol/org.local.LiquidWidgets1.xml'));
if (!node.lookup_interface('org.local.LiquidWidgets1')) throw new Error('missing interface');
print('GJS: bundled validators, Korean text and D-Bus XML passed');
