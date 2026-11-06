#!/usr/bin/env python3
"""Check emitted artifacts, metadata/schema and GNOME process separation."""
from pathlib import Path
import argparse,json,subprocess,xml.etree.ElementTree as ET
from package_policy import validate_process_imports,validate_public
from package import public_files
ROOT=Path(__file__).resolve().parent.parent


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--edition',choices=['rust','gjs','all'],default='rust');args=parser.parse_args()
    editions=json.loads((ROOT/'extension/editions.json').read_text())
    for name in ['rust','gjs'] if args.edition=='all' else [args.edition]:
        edition=editions[name];extension=ROOT/'extension'/edition['output']
        metadata=json.loads((extension/'metadata.json').read_text())
        assert metadata['uuid']==edition['uuid']
        assert metadata['shell-version']==['50']
        assert metadata['url']==edition['homepage']
        assert metadata['settings-schema']==edition['schemaId']
        schema=ET.parse(extension/'schemas'/f"{edition['schemaId']}.gschema.xml").getroot().find('schema')
        assert schema is not None and schema.get('id')==edition['schemaId'] and schema.get('path')==edition['schemaPath']
        if name=='gjs':validate_public(public_files(ROOT,extension),release=False)
        else:validate_process_imports({entry:(extension/entry).read_bytes() for entry in ['extension.js','prefs.js']})
        subprocess.run(['glib-compile-schemas','--strict','--dry-run',str(extension/'schemas')],check=True)
        print(f'BUILD_TEST: {name} metadata/schema, process imports and artifact policy passed')


if __name__=='__main__':main()
