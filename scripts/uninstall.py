#!/usr/bin/env python3
"""Remove Liquid Widgets. Keep settings/cache/secrets unless --purge-data is explicit."""
import argparse,subprocess,sys
from pathlib import Path
from install_lib import Paths,uninstall,live_paths
from install import artifacts,run

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--purge-data',action='store_true',help='Also delete app settings/cache/calendar secret; keyring failure aborts removal');parser.add_argument('--destdir',type=Path,help='Remove only staged files without changing the desktop or service');args=parser.parse_args()
    if args.destdir and args.purge_data:raise ValueError('Staging cannot delete real calendar secrets; omit --purge-data')
    target=Paths.for_root(args.destdir.resolve()) if args.destdir else live_paths()
    uninstall(artifacts(),target,run,purge=args.purge_data,activate=not args.destdir)
    print('Liquid Widgets removed. '+('Settings, cache and calendar secrets deleted.' if args.purge_data else 'Settings, cache and calendar secrets kept.'))
    print('Other extensions and desktop settings were preserved. Installation backups remain available.')
if __name__=='__main__':
    try:main()
    except (OSError,ValueError,RuntimeError,subprocess.SubprocessError) as error:
        print(f'Removal is incomplete: {error}\nIf the keyring is locked, unlock it and retry. The program is kept when secret deletion fails.',file=sys.stderr);sys.exit(1)
