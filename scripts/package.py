#!/usr/bin/env python3
"""Build readable extension ZIP plus a separate Rust service and user installer."""
from pathlib import Path
import hashlib,json,os,shutil,subprocess,tarfile,zipfile
ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'dist/liquid-widgets'
def run(args):subprocess.run(args,cwd=ROOT,check=True)
def main():
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
    shutil.copy2(ROOT/'daemon/target/release/liquid-widgets-daemon',OUT/'liquid-widgets-daemon')
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
if __name__=='__main__':main()
