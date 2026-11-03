#!/usr/bin/env python3
"""Optional local tool bootstrap for the project's Ubuntu 26.04 x86_64 host.
Writes only .tools; no sudo, shell-profile edits, or system package installation.
"""
from pathlib import Path
import hashlib
import json
import os
import platform
import subprocess
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
TOOLS = ROOT / '.tools'
DOWNLOADS = TOOLS / 'downloads'
NODE = 'v24.22.2'
RUST = '1.99.1'


def fetch(url, path):
    with urllib.request.urlopen(url, timeout=60) as response, path.open('wb') as output:
        while chunk := response.read(1024 * 1024):
            output.write(chunk)


def checked(url, path, checksum):
    if not path.exists() or hashlib.sha256(path.read_bytes()).hexdigest() != checksum:
        fetch(url, path)
    if hashlib.sha256(path.read_bytes()).hexdigest() != checksum:
        raise RuntimeError(f'Checksum mismatch: {path.name}')


def main():
    if platform.system() != 'Linux' or platform.machine() != 'x86_64':
        raise SystemExit('This optional bootstrap targets Ubuntu 26.04 x86_64. See docs/setup.md.')
    release = platform.freedesktop_os_release()
    if release.get('ID') != 'ubuntu' or release.get('VERSION_ID') != '26.04':
        raise SystemExit('Use your distribution toolchain; this bootstrap targets Ubuntu 26.04.')
    DOWNLOADS.mkdir(parents=True, exist_ok=True)
    print('Preparing local GCC and libical headers', flush=True)
    packages = ['gcc-15-x86-64-linux-gnu', 'cpp-15-x86-64-linux-gnu', 'libgcc-15-dev',
                'libical-dev', 'libical3t64', 'libicu-dev']
    with (TOOLS / 'bootstrap-packages.log').open('w') as log:
        subprocess.run(['apt-get', 'download', *packages], cwd=DOWNLOADS,
                       stdout=log, stderr=subprocess.STDOUT, check=True)
    for package in DOWNLOADS.glob('*.deb'):
        subprocess.run(['dpkg-deb', '-x', str(package), str(TOOLS / 'sysroot')], check=True)
    (TOOLS / 'bin').mkdir(exist_ok=True)
    cc = TOOLS / 'bin/cc'
    cc.write_text('#!/bin/sh\nset -eu\n'
                  'tools_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)\n'
                  'exec "$tools_root/sysroot/usr/bin/x86_64-linux-gnu-gcc-15" '
                  '-B"$tools_root/sysroot/usr/lib/gcc/x86_64-linux-gnu/15/" "$@"\n')
    cc.chmod(0o755)
    print(f'Preparing Node {NODE}', flush=True)
    archive = f'node-{NODE}-linux-x64.tar.xz'
    base = f'https://nodejs.org/dist/{NODE}/'
    sums = urllib.request.urlopen(base + 'SHASUMS256.txt', timeout=30).read().decode()
    node_sha = next(line.split()[0] for line in sums.splitlines() if line.split()[-1] == archive)
    if not (TOOLS / 'node/bin/node').exists():
        checked(base + archive, DOWNLOADS / archive, node_sha)
        with tarfile.open(DOWNLOADS / archive) as tar:
            tar.extractall(TOOLS, filter='data')
        (TOOLS / f'node-{NODE}-linux-x64').rename(TOOLS / 'node')
    print(f'Preparing Rust {RUST}', flush=True)
    rustup_url = 'https://static.rust-lang.org/rustup/dist/x86_64-unknown-linux-gnu/rustup-init'
    rustup_sha = urllib.request.urlopen(rustup_url + '.sha256', timeout=30).read().decode().split()[0]
    env = os.environ | {'CARGO_HOME': str(TOOLS / 'cargo'), 'RUSTUP_HOME': str(TOOLS / 'rustup')}
    with (TOOLS / 'bootstrap-rust.log').open('w') as log:
        if not (TOOLS / 'cargo/bin/rustup').exists():
            checked(rustup_url, DOWNLOADS / 'rustup-init', rustup_sha)
            (DOWNLOADS / 'rustup-init').chmod(0o755)
            subprocess.run([str(DOWNLOADS / 'rustup-init'), '-y', '--no-modify-path', '--default-toolchain', 'none'],
                           env=env, stdout=log, stderr=subprocess.STDOUT, check=True)
        subprocess.run([str(TOOLS / 'cargo/bin/rustup'), 'toolchain', 'install', RUST,
                        '--profile', 'minimal', '--component', 'rustfmt', '--component', 'clippy'],
                       env=env, stdout=log, stderr=subprocess.STDOUT, check=True)
    (TOOLS / 'versions.json').write_text(json.dumps(dict(node=NODE, nodeSha256=node_sha,
        rust=RUST, rustupInitSha256=rustup_sha, packages=packages), indent=2) + '\n')
    print('Ready. Run ./scripts/dev npm --prefix extension ci, then ./scripts/check.sh', flush=True)


if __name__ == '__main__':
    main()
