import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import { capture } from './helpers.js';
export const METRICS = {};
const uuid = 'liquid-widgets@nyongcho.github.io';
function check(value, message) {
    if (!value) throw new Error(message);
}
async function until(test, message) {
    const deadline = GLib.get_monotonic_time() + 12000000;
    while (!(await test())) {
        check(GLib.get_monotonic_time() < deadline, message);
        await Scripting.sleep(20);
    }
}
const owned = (name) =>
    new Promise((resolve, reject) =>
        Gio.DBus.session.call(
            'org.freedesktop.DBus',
            '/org/freedesktop/DBus',
            'org.freedesktop.DBus',
            'NameHasOwner',
            new GLib.Variant('(s)', [name]),
            null,
            Gio.DBusCallFlags.NO_AUTO_START,
            2000,
            null,
            (connection, result) => {
                try {
                    resolve(connection.call_finish(result).deep_unpack()[0]);
                } catch (error) {
                    reject(error);
                }
            },
        ),
    );
const command = (argv) =>
    new Promise((resolve, reject) => {
        const child = Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE);
        child.wait_check_async(null, (process, result) => {
            try {
                process.wait_check_finish(result);
                resolve();
            } catch (error) {
                reject(error);
            }
        });
    });

async function checkPackagedWorker(path) {
    const header = {
        version: 1,
        jobId: 'package-test',
        sourceId: 'synthetic',
        generation: 1,
        context: { month: '2026-11', timeZone: 'Asia/Seoul', weekStart: 1 },
        now: '2026-11-03T00:00:00Z',
    };
    const ics =
        'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:package-test\r\nDTSTART;TZID=Asia/Seoul:20261104T120000\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
    const frames = [JSON.stringify(header), ics].map((text) => {
        const body = new TextEncoder().encode(text),
            frame = new Uint8Array(body.length + 4);
        new DataView(frame.buffer).setUint32(0, body.length, false);
        frame.set(body, 4);
        return frame;
    });
    const input = new Uint8Array(frames[0].length + frames[1].length);
    input.set(frames[0]);
    input.set(frames[1], frames[0].length);
    const child = Gio.Subprocess.new(
        ['gjs', '-m', `${path}/calendar-worker.js`],
        Gio.SubprocessFlags.STDIN_PIPE |
            Gio.SubprocessFlags.STDOUT_PIPE |
            Gio.SubprocessFlags.STDERR_PIPE,
    );
    let timeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 12000, () => {
        timeout = 0;
        child.force_exit();
        return GLib.SOURCE_REMOVE;
    });
    try {
        const [output, errors] = await new Promise((resolve, reject) => {
            child.communicate_async(new GLib.Bytes(input), null, (process, result) => {
                try {
                    const [, out, err] = process.communicate_finish(result);
                    resolve([out.get_data(), err.get_data()]);
                } catch (error) {
                    reject(error);
                }
            });
        });
        check(child.get_successful() && errors.length === 0, 'packaged worker failed');
        const replies = [];
        for (let offset = 0; offset < output.length;) {
            check(offset + 4 <= output.length, 'truncated packaged worker frame');
            const size = new DataView(output.buffer, output.byteOffset + offset, 4).getUint32(
                0,
                false,
            );
            offset += 4;
            check(size > 0 && offset + size <= output.length, 'invalid packaged worker frame');
            replies.push(
                JSON.parse(
                    new TextDecoder('utf-8', { fatal: true }).decode(
                        output.slice(offset, offset + size),
                    ),
                ),
            );
            offset += size;
        }
        check(
            replies.length === 2 && replies[0].state === 'ready' && replies[1].ok,
            'packaged worker did not return a result',
        );
        check(
            replies[1].data.events[0]?.occurrenceKey === '2026-11-04T03:00:00Z',
            'packaged timezone data did not resolve Seoul',
        );
        check(
            !(await owned('io.github.NyongCho.LiquidWidgets.CalendarJob')),
            'packaged worker retained its lease',
        );
    } finally {
        if (timeout) GLib.source_remove(timeout);
    }
}

export async function run() {
    Main.overview.hide();
    await Scripting.sleep(1000);
    const extension = Main.extensionManager.lookup(uuid),
        ext = extension?.stateObj;
    check(extension?.state === 1 && ext?.host && ext.client, 'packaged extension did not enable');
    const installed = Gio.File.new_for_path(ext.path);
    check(
        ext.path.startsWith(`${GLib.get_user_data_dir()}/gnome-shell/extensions/`),
        'refusing to uninstall outside the disposable data directory',
    );
    check(GLib.getenv('GSETTINGS_BACKEND') === 'keyfile', 'private settings are required');
    check(typeof ext.client.setCalendarWatchers === 'function', 'ZIP selected the wrong backend');
    check(installed.get_child('calendar-worker.js').query_exists(null), 'ZIP worker is missing');
    check(!installed.get_child('tests').query_exists(null), 'ZIP contains test fixtures');
    await until(
        () => owned('io.github.NyongCho.LiquidWidgets.Status'),
        'public status bridge missing',
    );
    check(!(await owned('org.local.LiquidWidgets')), 'public ZIP started the personal service');
    await checkPackagedWorker(ext.path);
    ext.settings.set_strv('visible', [
        'clock',
        'calendar',
        'agenda',
        'weather',
        'system',
        'network',
        'media',
    ]);
    await until(
        () =>
            ext.host.states.get('system')?.status === 'ok' &&
            ext.host.states.get('network')?.status === 'ok',
        'packaged local collectors did not publish',
    );
    await command(['gnome-extensions', 'prefs', uuid]);
    let prefs;
    await until(() => {
        prefs = global
            .get_window_actors()
            .find((actor) => actor.mapped && actor.meta_window.get_title() === 'Liquid Widgets');
        return prefs;
    }, 'packaged preferences did not open');
    await until(() => ext.client.watchers === 1, 'packaged preferences did not subscribe');
    prefs.meta_window.activate(global.get_current_time());
    await until(() => prefs.opacity === 255, 'packaged preferences did not finish appearing');
    await Scripting.sleep(300); // Let GTK's initial frame and Shell's map animation paint.
    await capture('public-package-installed');
    prefs.meta_window.delete(global.get_current_time());
    await until(() => ext.client.watchers === 0, 'packaged preferences left demand');
    // Retain the wrappers deliberately: cleanup must not depend on JS garbage collection.
    ext.settings.set_string('clock-style', 'classic');
    ext.settings.set_boolean('low-power', false);
    const host = ext.host,
        cards = [...host.cards.values()],
        clock = host.clockFaces.get(host.cards.get('clock'));
    await until(() => clock?.timer > 0, 'analog clock timer did not start');
    const clockTimer = clock.timer;
    const actors = [
        host.actor,
        host.settingsButton,
        clock.actor,
        clock.area,
        ...cards.flatMap((card) => [card.surface.actor, card.button, card.status, card.mode]),
    ];
    const destroyed = new Set();
    for (const actor of actors) actor.connect('destroy', () => destroyed.add(actor));
    const surfaces = cards.map((card) => card.surface);
    const session = ext.client;
    Main.extensionManager.disableExtension(uuid);
    check(destroyed.size === actors.length, 'owned widget actors survived disable');
    check(
        host.cards.size === 0 && ext.host === null,
        'extension retained its widget host or cards',
    );
    check(
        clock.timer === 0 && !GLib.MainContext.default().find_source_by_id(clockTimer),
        'analog clock timer survived disable',
    );
    for (const surface of surfaces) {
        surface.effect.emit('failed');
        check(surface.fallbackIdle === 0, 'disposed glass surface retained its failure callback');
    }
    await until(() => extension.state === 2, 'packaged extension did not disable');
    await session.drained;
    check(session.dead && session.unwatch === null, 'packaged session retained resources');
    check(
        !(await owned('io.github.NyongCho.LiquidWidgets.Status')),
        'packaged status bridge survived disable',
    );
    check(
        !(await owned('io.github.NyongCho.LiquidWidgets.CalendarJob')),
        'packaged worker survived disable',
    );
    await command(['gnome-extensions', 'uninstall', uuid]);
    check(!installed.query_exists(null), 'uninstall retained extension files');
    GLib.file_set_contents(
        `${GLib.getenv('LIQUID_TEST_OUTPUT')}/package.json`,
        JSON.stringify({
            uuid,
            enabled: true,
            packagedWorker: true,
            timeZoneData: true,
            localCollectors: true,
            preferences: true,
            disabled: true,
            widgetActorsDestroyed: destroyed.size,
            clockTimerStopped: true,
            glassCallbacksDisconnected: true,
            uninstalled: true,
            rustService: false,
        }),
    );
    print(
        'PACKAGE_TEST: final public ZIP installed, enabled, collected, opened preferences, disabled and uninstalled without Rust',
    );
}
