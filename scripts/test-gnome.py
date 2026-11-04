#!/usr/bin/env python3
"""Visible GNOME 50 integration test, always on a private D-Bus session."""
from pathlib import Path
import os
import signal
import subprocess
import sys
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parent.parent
WORK = ROOT / '.superpowers/sdd/liquid-glass-plan'
SHOT_MODE = next((flag[2:] for flag in ('--clock-styles', '--card-order', '--system', '--media-art', '--compact', '--blur', '--preferences', '--visual', '--lifecycle', '--benchmark', '--soak', '--spike') if flag in sys.argv), 'functional')
SHOTS = WORK / 'screenshots' / SHOT_MODE


def verify_images():
    from PIL import Image, ImageChops

    def read(name):
        return Image.open(SHOTS / f'{name}.png').convert('RGB')

    off, on, background = (read(name) for name in ('glass-off', 'glass-on', 'background'))
    # Compare only the curved edge: button text deliberately differs between modes.
    edge = (420, 205, 442, 420)
    assert ImageChops.difference(off.crop(edge), on.crop(edge)).getbbox(), 'refraction edge did not change'
    # The material deliberately changes luminance for readable text. Compare
    # spatial color structure in linear chromaticity, not raw brightness.
    # Average the source's fine grid before comparing the blurred material.
    def chromaticity(rgb):
        linear = [(v/255/12.92 if v/255 <= .04045 else ((v/255+.055)/1.055)**2.4) for v in rgb]
        total = max(sum(linear), .0001)
        return [v/total for v in linear]
    errors = []
    for y in [290, 325, 410]:
        for x in [470, 510, 550, 590, 630, 670, 710]:
            patch = [background.getpixel((px, py)) for py in range(y-6, y+7) for px in range(x-6, x+7)]
            expected = chromaticity([sum(p[c] for p in patch)/len(patch) for c in range(3)])
            actual = chromaticity(off.getpixel((x, y)))
            errors.append(max(abs(a-b) for a, b in zip(actual, expected)))
    assert sum(errors)/len(errors) < .015 and max(errors) < .06, 'wallpaper color structure is misaligned'
    text_region = (444, 224, 715, 257)
    # Pixel iteration also works with older distribution Pillow releases.
    def pixels(im):
        return [im.getpixel((x, y)) for y in range(im.height) for x in range(im.width)]
    text_a = [min(p) > 245 for p in pixels(off.crop(text_region))]
    text_b = [min(p) > 245 for p in pixels(on.crop(text_region))]
    assert sum(text_a) > 100 and text_a == text_b, 'foreground text missing or distorted'
    # The alternate fixture replaces pink light with green; stale input must fail.
    before = on.getpixel((700, 300))
    after = read('wallpaper-changed').getpixel((700, 300))
    assert before[0]-before[1] > 15 and after[1]-after[0] > 30, 'card still shows the old wallpaper'
    selected, dragged, idle = (read(name) for name in ('icon-selected', 'icon-dragged', 'ding-enabled'))
    box = (10, 35, 115, 145)
    assert ImageChops.difference(selected.crop(box), idle.crop(box)).getbbox(), 'icon selection missing'
    def white(im, box):
        return sum(min(p) > 220 for p in pixels(im.crop(box)))
    assert white(selected, (30, 40, 95, 102)) > 1000, 'icon missing from source position'
    assert white(dragged, (30, 40, 95, 102)) < 250, 'icon did not leave source after drag'
    assert white(dragged, (260, 160, 380, 235)) > 1000, 'icon missing from drag destination'
    print('LIQUID_TEST: refraction edge, wallpaper alignment, sharp text, wallpaper refresh, icon selection/drag passed')


def main():
    if '--child' not in sys.argv:
        # Keep runtime outside test-tool's temporary XDG root: portal mounts
        # are released only after the private bus has shut down.
        with tempfile.TemporaryDirectory(prefix='liquid-widgets-runtime-') as runtime:
            env = os.environ | {'LIQUID_PARENT_BUS': os.environ.get('DBUS_SESSION_BUS_ADDRESS', ''), 'GVFS_DISABLE_FUSE': '1', 'LIQUID_TEST_RUNTIME': runtime}
            result = subprocess.run(['dbus-run-session', '--', sys.executable, str(Path(__file__).resolve()), '--child', *sys.argv[1:]], env=env).returncode
            for name in ('doc', 'gvfs'):
                mount = Path(runtime) / name
                if mount.is_mount():
                    # Portal shutdown may unmount between the check and command.
                    subprocess.run(['fusermount3', '-uz', str(mount)], check=False, capture_output=True)
                    if mount.is_mount(): raise RuntimeError(f'Could not release private test mount: {mount}')
            return result
    if not os.environ.get('LIQUID_PARENT_BUS') or os.environ.get('DBUS_SESSION_BUS_ADDRESS') == os.environ['LIQUID_PARENT_BUS']:
        raise SystemExit('Refusing to use the live desktop bus; launch from a graphical session')
    if not os.environ.get('WAYLAND_DISPLAY'):
        raise SystemExit('A visible Wayland desktop is required')
    os.chdir(ROOT)
    SHOTS.mkdir(parents=True, exist_ok=True)
    env = os.environ | {'LIQUID_TEST_DISPLAY': f'liquid-widgets-test-{os.getpid()}', 'GIO_USE_VFS': 'local', 'GTK_A11Y': 'none', 'LIQUID_TEST_OUTPUT': str(SHOTS), 'LIQUID_TEST_DAEMON': str(ROOT / 'daemon/target/debug/liquid-widgets-daemon'), 'LIQUID_TEST_PREFS': str(ROOT / 'extension/dist/tests/preferences.js'), 'LIQUID_TEST_CARD_ORDER': str(ROOT / 'extension/dist/tests/card-order.js'), 'LIQUID_TEST_SCHEMAS': str(ROOT / 'extension/dist/schemas'), 'LIQUID_CLOCK_TICKS': str(os.sysconf('SC_CLK_TCK')), 'LIQUID_SOAK_SECONDS': '1800' if '--soak' in sys.argv else '0'}
    archive = WORK / 'liquid-widgets.shell-extension.zip'
    with zipfile.ZipFile(archive, 'w') as output:
        for file in (ROOT / 'extension/dist').rglob('*'):
            if not file.is_file() or 'tests' in file.relative_to(ROOT / 'extension/dist').parts: continue
            if '--spike' in sys.argv and file.name == 'extension.js':
                output.write(ROOT / 'extension/dist/tests/spike.js', 'extension.js')
            else: output.write(file, str(file.relative_to(ROOT / 'extension/dist')))
    system_viewer = Path('/usr/libexec/mutter-devkit')
    local_viewer = ROOT / '.tools/sysroot/usr/libexec/mutter-devkit'
    if not system_viewer.exists() and not local_viewer.exists():
        raise SystemExit('mutter-devkit missing; see docs/shader-spike.md')
    shell = subprocess.Popen([
        'gnome-shell-test-tool', '--devkit', '--wrap', str(ROOT / 'scripts/gnome-test-env.py'),
        '--extension', str(archive), str(ROOT / ('tests/gnome/clock-styles.js' if '--clock-styles' in sys.argv else 'tests/gnome/card-order.js' if '--card-order' in sys.argv else 'tests/gnome/system.js' if '--system' in sys.argv else 'tests/gnome/media-art.js' if '--media-art' in sys.argv else 'tests/gnome/compact.js' if '--compact' in sys.argv else 'tests/gnome/blur.js' if '--blur' in sys.argv else 'tests/gnome/glass-spike.js' if '--spike' in sys.argv else 'tests/gnome/preferences.js' if '--preferences' in sys.argv else 'tests/gnome/visual.js' if '--visual' in sys.argv else 'tests/gnome/lifecycle.js' if '--lifecycle' in sys.argv else 'tests/gnome/benchmark.js' if '--benchmark' in sys.argv or '--soak' in sys.argv else 'tests/gnome/widgets.js')),
    ], env=env, start_new_session=True)
    viewer = None
    try:
        subprocess.run(['gdbus', 'wait', '--session', '--timeout', '15', 'org.gnome.Mutter.Devkit'], env=env, check=True)
        # Mutter launches the system viewer itself. Only supplement a missing binary.
        if not system_viewer.exists():
            viewer = subprocess.Popen([str(local_viewer)], env=env)
        result = shell.wait(timeout=2300 if '--soak' in sys.argv else 300 if '--benchmark' in sys.argv else 120)
        if result:
            return result
        if '--spike' in sys.argv: verify_images()
        return 0
    finally:
        try:
            os.killpg(shell.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        shell.wait(timeout=10)
        if viewer and viewer.poll() is None:
            viewer.terminate()
            viewer.wait(timeout=10)


if __name__ == '__main__':
    raise SystemExit(main())
