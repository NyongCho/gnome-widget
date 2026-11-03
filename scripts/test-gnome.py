#!/usr/bin/env python3
"""Visible GNOME 50 integration test, always on a private D-Bus session."""
from pathlib import Path
import os
import signal
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parent.parent
WORK = ROOT / '.superpowers/sdd/liquid-glass-plan'
SHOTS = WORK / 'screenshots'


def verify_images():
    from PIL import Image, ImageChops

    def read(name):
        return Image.open(SHOTS / f'{name}.png').convert('RGB')

    off, on, background = (read(name) for name in ('glass-off', 'glass-on', 'background'))
    # Compare only the curved edge: button text deliberately differs between modes.
    edge = (420, 205, 442, 420)
    assert ImageChops.difference(off.crop(edge), on.crop(edge)).getbbox(), 'refraction edge did not change'
    for point in [(500, 350), (600, 330), (700, 350)]:
        actual, expected = off.getpixel(point), background.getpixel(point)
        assert max(abs(a-b) for a, b in zip(actual, expected)) < 70, f'misaligned wallpaper at {point}'
    text_region = (444, 224, 715, 257)
    # Pixel iteration also works with older distribution Pillow releases.
    def pixels(im):
        return [im.getpixel((x, y)) for y in range(im.height) for x in range(im.width)]
    text_a = [min(p) > 245 for p in pixels(off.crop(text_region))]
    text_b = [min(p) > 245 for p in pixels(on.crop(text_region))]
    assert sum(text_a) > 100 and text_a == text_b, 'foreground text missing or distorted'
    selected, dragged, idle = (read(name) for name in ('icon-selected', 'icon-dragged', 'ding-enabled'))
    box = (10, 35, 115, 145)
    assert ImageChops.difference(selected.crop(box), idle.crop(box)).getbbox(), 'icon selection missing'
    def white(im, box):
        return sum(min(p) > 220 for p in pixels(im.crop(box)))
    assert white(selected, (30, 40, 95, 102)) > 1000, 'icon missing from source position'
    assert white(dragged, (30, 40, 95, 102)) < 250, 'icon did not leave source after drag'
    assert white(dragged, (260, 160, 380, 235)) > 1000, 'icon missing from drag destination'
    print('LIQUID_TEST: refraction edge, wallpaper alignment, sharp text, icon selection/drag passed')


def main():
    if '--child' not in sys.argv:
        env = os.environ | {'LIQUID_PARENT_BUS': os.environ.get('DBUS_SESSION_BUS_ADDRESS', '')}
        return subprocess.run(['dbus-run-session', '--', sys.executable, str(Path(__file__).resolve()), '--child'], env=env).returncode
    if not os.environ.get('LIQUID_PARENT_BUS') or os.environ.get('DBUS_SESSION_BUS_ADDRESS') == os.environ['LIQUID_PARENT_BUS']:
        raise SystemExit('Refusing to use the live desktop bus; launch from a graphical session')
    if not os.environ.get('WAYLAND_DISPLAY'):
        raise SystemExit('A visible Wayland desktop is required')
    os.chdir(ROOT)
    SHOTS.mkdir(parents=True, exist_ok=True)
    env = os.environ | {'GIO_USE_VFS': 'local', 'GTK_A11Y': 'none', 'LIQUID_TEST_OUTPUT': str(SHOTS)}
    archive = WORK / 'liquid-widgets.shell-extension.zip'
    with zipfile.ZipFile(archive, 'w') as output:
        for file in (ROOT / 'extension/dist').glob('*.js'):
            output.write(file, file.name)
        output.write(ROOT / 'extension/dist/metadata.json', 'metadata.json')
    system_viewer = Path('/usr/libexec/mutter-devkit')
    local_viewer = ROOT / '.tools/sysroot/usr/libexec/mutter-devkit'
    if not system_viewer.exists() and not local_viewer.exists():
        raise SystemExit('mutter-devkit missing; see docs/shader-spike.md')
    shell = subprocess.Popen([
        'gnome-shell-test-tool', '--devkit', '--wrap', str(ROOT / 'scripts/gnome-test-env.py'),
        '--extension', str(archive), str(ROOT / 'tests/gnome/glass-spike.js'),
    ], env=env, start_new_session=True)
    viewer = None
    try:
        subprocess.run(['gdbus', 'wait', '--session', '--timeout', '15', 'org.gnome.Mutter.Devkit'], env=env, check=True)
        # Mutter launches the system viewer itself. Only supplement a missing binary.
        if not system_viewer.exists():
            viewer = subprocess.Popen([str(local_viewer)], env=env)
        result = shell.wait(timeout=100)
        if result:
            return result
        verify_images()
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
