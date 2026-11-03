#!/usr/bin/env python3
"""Install this distribution for the current user; no sudo or session restart."""
import argparse,subprocess,sys
from pathlib import Path
from install_lib import Paths,install,live_paths

def artifacts():
    here=Path(__file__).resolve().parent
    return here if (here/'liquid-widgets.shell-extension.zip').exists() else here.parent/'dist/liquid-widgets'
def run(args,check=True):
    return subprocess.run(args,check=check,text=True,capture_output=True)
def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--destdir',type=Path,help='Stage files under this directory without activating the desktop or service');args=parser.parse_args()
    target=Paths.for_root(args.destdir.resolve()) if args.destdir else live_paths()
    if not args.destdir:
        version=run(['gnome-shell','--version']).stdout
        if not version.strip().split()[-1].startswith('50.'):raise RuntimeError('This build supports GNOME 50 only')
        libraries=run(['ldd',str(artifacts()/'liquid-widgets-daemon')]).stdout
        if 'not found' in libraries:raise RuntimeError('A service runtime library is missing; see the setup guide')
    backup=install(artifacts(),target,run,activate=not args.destdir)
    print(f'Installed to {target.extension}\nService binary: {target.app}\nPrevious files backed up at {backup}')
    if args.destdir:print('Staging only: no session settings or services were changed.')
if __name__=='__main__':
    try:main()
    except (OSError,ValueError,RuntimeError,subprocess.SubprocessError) as error:
        print(f'Installation failed: {error}',file=sys.stderr);sys.exit(1)
