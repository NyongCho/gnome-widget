#!/usr/bin/env python3
"""Configure only the temporary XDG environment created by GNOME's test tool."""
from pathlib import Path
from configparser import ConfigParser
import os, shutil, sys, subprocess
root=Path(__file__).resolve().parent.parent
config=Path(os.environ['XDG_CONFIG_HOME'])
data=Path(os.environ['XDG_DATA_HOME'])
work=Path(os.environ['LIQUID_TEST_OUTPUT'])
# Test-tool owns this temporary keyfile; never target the live dconf backend.
if os.environ.get('GSETTINGS_BACKEND') != 'keyfile' or config == Path.home()/'.config':
    raise SystemExit('Expected isolated GNOME test-tool environment')
# Shell's crash sentinel and Wayland sockets must not touch the live session.
# The Devkit viewer still connects to the outer compositor by absolute path.
outer_runtime=Path(os.environ['XDG_RUNTIME_DIR'])
outer_display=Path(os.environ['WAYLAND_DISPLAY'])
if not outer_display.is_absolute():os.environ['WAYLAND_DISPLAY']=str(outer_runtime/outer_display)
runtime=Path(os.environ['LIQUID_TEST_RUNTIME'])
os.environ['XDG_RUNTIME_DIR']=str(runtime)
os.environ['GNOME_KEYRING_CONTROL']=str(runtime/'keyring')
# Devkit streams the nested output through the existing PipeWire server.
os.environ['PIPEWIRE_RUNTIME_DIR']=str(outer_runtime)
apps=data/'applications';apps.mkdir(parents=True,exist_ok=True)
(apps/'liquid-test-browser.desktop').write_text(f'[Desktop Entry]\nType=Application\nName=Liquid Test Browser\nExec=/usr/bin/python3 {root}/tests/gnome/record-uri.py %u\nNoDisplay=true\nMimeType=x-scheme-handler/http;x-scheme-handler/https;\n')
(config/'mimeapps.list').write_text('[Default Applications]\nx-scheme-handler/http=liquid-test-browser.desktop\nx-scheme-handler/https=liquid-test-browser.desktop\n')
(work/'opened-uris.jsonl').write_text('')
desktop=work/'desktop'; desktop.mkdir(exist_ok=True)
(desktop/'Click and drag me.txt').write_text('Disposable Liquid Widgets desktop input fixture.\n')
(config/'user-dirs.dirs').write_text(f'XDG_DESKTOP_DIR="{desktop}"\n')
source=(root/'tests/gnome/refraction-grid.svg').read_text()
(work/'background.svg').write_text(source)
(work/'background-alternate.svg').write_text(source.replace('#ef9fbf','#40e89f').replace('#102b63','#2b142f'))
settings_file=config/'glib-2.0/settings/keyfile'
settings=ConfigParser();settings.read(settings_file)
settings['org/gnome/desktop/background']={'picture-uri':repr((work/'background.svg').as_uri()),'picture-uri-dark':repr((work/'background.svg').as_uri()),'picture-options':"'zoom'"}
settings['org/gnome/shell/extensions/ding']={'show-home':'false','show-trash':'false','show-volumes':'false','show-network-volumes':'false','start-corner':"'top-left'"}
with settings_file.open('w') as f: settings.write(f)
blur=Path.home()/'.local/share/gnome-shell/extensions/blur-my-shell@aunetx'
if blur.is_dir():
    target=data/'gnome-shell/extensions/blur-my-shell@aunetx'
    if not target.exists(): shutil.copytree(blur,target)
os.environ.pop('SHELL_BACKGROUND_IMAGE',None)
# D-Bus activated preferences/portal processes must join the test display and
# temporary settings, not inherit the outer desktop from dbus-run-session.
values=[f'{key}={os.environ[key]}' for key in ('XDG_CONFIG_HOME','XDG_DATA_HOME','XDG_CACHE_HOME','XDG_RUNTIME_DIR','PIPEWIRE_RUNTIME_DIR','GSETTINGS_BACKEND','GNOME_KEYRING_CONTROL','LIQUID_TEST_EDITION','LIQUID_TEST_UUID','LIQUID_TEST_SCHEMA','LIQUID_TEST_WORKER','LIQUID_TEST_FIXTURES') if key in os.environ]
display=os.environ.get('LIQUID_TEST_DISPLAY','gnome-shell-test-display')
subprocess.run(['dbus-update-activation-environment',f'WAYLAND_DISPLAY={display}',*values],check=True)
arguments=sys.argv[1:]
if '--wayland-display' in arguments: arguments[arguments.index('--wayland-display')+1]=display
os.execv(arguments[0],arguments)
