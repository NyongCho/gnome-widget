#!/usr/bin/env python3
"""Build either the standalone public ZIP or the personal Rust distribution."""
from pathlib import Path
import argparse,hashlib,json,os,shutil,subprocess,tarfile,zipfile
from package_policy import public_runtime_files,validate_public
ROOT=Path(__file__).resolve().parent.parent
def run(args):subprocess.run(args,cwd=ROOT,check=True)


def public_files(root,extension):
    files=public_runtime_files(extension)
    notices={'THIRD_PARTY_NOTICES.md':'THIRD_PARTY_NOTICES.md',
        'licenses/ical-MPL-2.0.txt':'extension/vendor/ical/LICENSE',
        'licenses/timezones.txt':'extension/vendor/timezones/LICENSE',
        'licenses/ajv-MIT.txt':'extension/node_modules/ajv/LICENSE',
        'licenses/ajv-formats-MIT.txt':'extension/node_modules/ajv-formats/LICENSE'}
    if (root/'LICENSE').is_file():notices['LICENSE']='LICENSE'
    files.update({name:(root/source).read_bytes() for name,source in notices.items()})
    files.update({f'shaders/{path.name}':path.read_bytes() for path in sorted((root/'extension/shaders').glob('*.glsl'))})
    return files


def package_public(development=False):
    run(['./scripts/dev','npm','--prefix','extension','run','build','--','--edition','gjs'])
    extension=ROOT/'extension/dist-gjs'
    run(['glib-compile-schemas','--strict','--dry-run',str(extension/'schemas')])
    files=public_files(ROOT,extension);validate_public(files,release=not development)
    output=ROOT/('dist/liquid-widgets-public-development' if development else 'dist/liquid-widgets-public')
    output.mkdir(parents=True,exist_ok=True)
    archive=output/'liquid-widgets.shell-extension.zip';temporary=archive.with_suffix('.zip.tmp')
    try:
        with zipfile.ZipFile(temporary,'w',zipfile.ZIP_DEFLATED) as bundle:
            for name,data in sorted(files.items()):bundle.writestr(name,data)
        temporary.replace(archive)
    finally:temporary.unlink(missing_ok=True)
    (output/'SHA256SUMS').write_text(f'{hashlib.sha256(archive.read_bytes()).hexdigest()}  {archive.name}\n')
    (output/'build-status.json').write_text(json.dumps({'edition':'gjs','development':development,
        'licensePresent':'LICENSE' in files,'submissionApproved':False},indent=2)+'\n')
    print(f'{"Development-only" if development else "Public"} ZIP: {archive}')
    return archive


def package_rust():
    OUT=ROOT/'dist/liquid-widgets'
    run(['./scripts/dev','cargo','build','--locked','--release','--manifest-path','daemon/Cargo.toml'])
    run(['./scripts/dev','npm','--prefix','extension','run','build'])
    OUT.mkdir(parents=True,exist_ok=True)
    extension=ROOT/'extension/dist';metadata=json.loads((extension/'metadata.json').read_text())
    assert metadata['uuid']=='liquid-widgets@local' and metadata['shell-version']==['50']
    run(['glib-compile-schemas','--strict','--dry-run',str(extension/'schemas')])
    with zipfile.ZipFile(OUT/'liquid-widgets.shell-extension.zip','w',zipfile.ZIP_DEFLATED) as bundle:
        for name in ['extension.js','prefs.js','metadata.json','stylesheet.css']:
            bundle.write(extension/name,name)
        for file in sorted((extension/'schemas').iterdir()):
            if file.is_file():bundle.write(file,str(file.relative_to(extension)))
        for file in sorted((ROOT/'extension/shaders').glob('*.glsl')):
            bundle.write(file,f'shaders/{file.name}')
    target=Path(os.environ.get('CARGO_TARGET_DIR',ROOT/'daemon/target'))
    shutil.copy2(target/'release/liquid-widgets-daemon',OUT/'liquid-widgets-daemon')
    shutil.copy2(ROOT/'packaging/liquid-widgets.service',OUT/'liquid-widgets.service')
    for file in ['install.py','uninstall.py','install_lib.py']:shutil.copy2(ROOT/'scripts'/file,OUT/file)
    for name in ['install.py','uninstall.py','liquid-widgets-daemon']:(OUT/name).chmod(0o755)
    (OUT/'README.md').write_text('# Liquid Widgets for GNOME 50\n\nInstall: `./install.py` (no sudo). New or updated extension code may require logout/login.\n\nRemove: `./uninstall.py`. Also delete private data: `./uninstall.py --purge-data`.\n\nThe service needs libical.so.3 and a session Secret Service. Calendar URL and weather city are entered in extension preferences.\n\nSee the project docs/setup.md and docs/verification.md for supported scope and remaining human acceptance.\n')
    metadata=subprocess.check_output(['./scripts/dev','cargo','metadata','--locked','--format-version','1','--manifest-path','daemon/Cargo.toml'],cwd=ROOT,text=True)
    packages=json.loads(metadata)['packages'];(OUT/'dependency-licenses.json').write_text(json.dumps([{'name':p['name'],'version':p['version'],'license':p['license'],'repository':p['repository']} for p in packages],indent=2)+'\n')
    hashes=[]
    for file in sorted(OUT.iterdir()):
        if file.is_file() and file.name!='SHA256SUMS':hashes.append(f'{hashlib.sha256(file.read_bytes()).hexdigest()}  {file.name}')
    (OUT/'SHA256SUMS').write_text('\n'.join(hashes)+'\n')
    with tarfile.open(ROOT/'dist/liquid-widgets-linux-x86_64.tar.gz','w:gz') as bundle:
        for file in sorted(OUT.iterdir()):
            if file.is_file():bundle.add(file,arcname=f'{OUT.name}/{file.name}')
    print(f'Distribution: {OUT}')


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--edition',choices=['rust','gjs'],default='rust')
    parser.add_argument('--development',action='store_true',help='public validation ZIP only; never a submission artifact')
    args=parser.parse_args(argv)
    if args.development and args.edition!='gjs':parser.error('--development is only for the public edition')
    if args.edition=='gjs':
        if not args.development and not (ROOT/'LICENSE').is_file():
            parser.error('Owner-selected GPL-compatible LICENSE is missing. Use --development only for local validation.')
        return package_public(args.development)
    return package_rust()


if __name__=='__main__':main()
