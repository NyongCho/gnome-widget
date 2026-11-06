"""Run the spike on the existing isolated GNOME harness, with no data service."""
from pathlib import Path
import os,signal,subprocess,sys,tempfile,zipfile
ROOT=Path(__file__).resolve().parents[3]
HERE=Path(__file__).resolve().parent
if '--child' not in sys.argv:
    with tempfile.TemporaryDirectory(prefix='liquid-inprocess-runtime-') as runtime:
        env=os.environ|{'LIQUID_PARENT_BUS':os.environ.get('DBUS_SESSION_BUS_ADDRESS',''),'LIQUID_TEST_RUNTIME':runtime,'GVFS_DISABLE_FUSE':'1'}
        result=subprocess.run(['dbus-run-session','--',sys.executable,__file__,'--child'],env=env).returncode
        for name in ('doc','gvfs'):
            path=Path(runtime)/name
            if path.is_mount():subprocess.run(['fusermount3','-uz',str(path)],check=True)
        raise SystemExit(result)
if not os.environ.get('LIQUID_PARENT_BUS') or os.environ['LIQUID_PARENT_BUS']==os.environ.get('DBUS_SESSION_BUS_ADDRESS'):
    raise SystemExit('Refusing to run on the live desktop bus')
out=HERE/'results';out.mkdir(exist_ok=True)
archive=out/'fixture-extension.zip'
with zipfile.ZipFile(archive,'w') as bundle:
    for file in (ROOT/'extension/dist').rglob('*'):
        if file.is_file() and 'tests' not in file.relative_to(ROOT/'extension/dist').parts:bundle.write(file,str(file.relative_to(ROOT/'extension/dist')))
env=os.environ|{'LIQUID_TEST_OUTPUT':str(out),'LIQUID_TEST_DISPLAY':f'liquid-spike-{os.getpid()}','GIO_USE_VFS':'local','GTK_A11Y':'none'}
process=subprocess.Popen(['gnome-shell-test-tool','--devkit','--wrap',str(ROOT/'scripts/gnome-test-env.py'),'--extension',str(archive),str(HERE/'shell.js')],env=env,start_new_session=True)
viewer=None
try:
    subprocess.run(['gdbus','wait','--session','--timeout','15','org.gnome.Mutter.Devkit'],env=env,check=True)
    if not Path('/usr/libexec/mutter-devkit').exists():
        viewer=subprocess.Popen([str(ROOT/'.tools/sysroot/usr/libexec/mutter-devkit')],env=env)
    result=process.wait(timeout=180)
finally:
    try:os.killpg(process.pid,signal.SIGTERM)
    except ProcessLookupError:pass
    process.wait(timeout=10)
    if viewer and viewer.poll() is None:
        viewer.terminate();viewer.wait(timeout=10)
raise SystemExit(result)
