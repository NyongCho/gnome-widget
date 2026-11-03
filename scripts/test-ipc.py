#!/usr/bin/env python3
"""Run the real Rust binary/GJS client on a private bus with disposable XDG paths."""
from pathlib import Path
import os
import subprocess
import tempfile
ROOT=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='liquid-ipc-') as temp:
    env=os.environ | {'GIO_USE_VFS':'local','LIQUID_PRIVATE_TEST':'1','LIQUID_PARENT_BUS':os.environ.get('DBUS_SESSION_BUS_ADDRESS',''),
        'XDG_CONFIG_HOME':temp+'/config','XDG_CACHE_HOME':temp+'/cache',
        'LIQUID_DAEMON':str(ROOT/'daemon/target/debug/liquid-widgets-daemon')}
    raise SystemExit(subprocess.run(['dbus-run-session','--','gjs','-m',str(ROOT/'extension/tests/gjs-ipc.js')],env=env,cwd=ROOT,timeout=30).returncode)
