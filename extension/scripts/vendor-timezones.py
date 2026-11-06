#!/usr/bin/env python3
"""Canonicalize pinned vzic output; this build tool is never shipped in the ZIP."""
import argparse
import hashlib
import json
from pathlib import Path

SOURCES = ['africa', 'antarctica', 'asia', 'australasia', 'europe',
           'northamerica', 'southamerica', 'backward', 'etcetera']
ARCHIVE_SHA256 = 'b26882805f26aac59d5b222978e6580484b834ccdc98be89df2f05a6dc53a652'

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('tzdb', type=Path)
    parser.add_argument('archive', type=Path)
    args = parser.parse_args()
    assert hashlib.sha256(args.archive.read_bytes()).hexdigest() == ARCHIVE_SHA256
    assert (args.tzdb / 'version').read_text().strip() == '2026e'
    expected = set()
    for name in SOURCES:
        for line in (args.tzdb / name).read_text().splitlines():
            fields = line.split('#', 1)[0].split()
            if fields and fields[0] == 'Zone': expected.add(fields[1])
            elif fields and fields[0] == 'Link': expected.add(fields[2])
    zones = {}
    for path in sorted((args.tzdb / 'zoneinfo').rglob('*.ics')):
        value = path.read_text()
        value = value[value.index('BEGIN:VTIMEZONE'):value.index('END:VTIMEZONE') + len('END:VTIMEZONE')]
        # Generator wall-clock metadata is not timezone data.
        value = '\n'.join(line for line in value.splitlines() if not line.startswith('LAST-MODIFIED:')) + '\n'
        zones[str(path.relative_to(args.tzdb / 'zoneinfo'))[:-4]] = value
    assert expected <= zones.keys(), f'Missing timezones: {expected - zones.keys()}'
    output = Path(__file__).resolve().parents[1] / 'vendor/timezones'
    output.mkdir(parents=True, exist_ok=True)
    data = (json.dumps(zones, ensure_ascii=False, indent=2) + '\n').encode()
    (output / 'zones.json').write_bytes(data)
    (output / 'LICENSE').write_bytes((args.tzdb / 'LICENSE').read_bytes())
    manifest = dict(tzdb='2026e', source='https://data.iana.org/time-zones/releases/tzdata2026e.tar.gz',
                    sourceSha256=ARCHIVE_SHA256, generator='https://github.com/libical/vzic',
                    generatorCommit='42f509c9a613874a04af0d35be166c703a77389f',
                    icalWorkflowCommit='277d52c8db379f133a88957793e03997a65307f4',
                    options=['--pure', 'TZID_PREFIX=', 'CREATE_SYMLINK=0', 'IGNORE_TOP_LEVEL_LINK=0'],
                    zoneCount=len(zones), zonesSha256=hashlib.sha256(data).hexdigest(),
                    license='IANA public domain; generator GPL-2.0-or-later is build-only')
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Bundled {len(zones)} zones/aliases; all {len(expected)} source names covered')

if __name__ == '__main__': main()
