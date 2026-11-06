"""Reject unreviewable or misplaced runtime content in the public artifact."""
import json
import importlib.util
import io
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch
from contextlib import redirect_stderr

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from package_policy import validate_public


def artifact():
    return {
        'metadata.json': json.dumps({'uuid':'liquid-widgets@nyongcho.github.io','name':'Liquid Widgets',
            'description':'Desktop widgets','shell-version':['50'],
            'settings-schema':'org.gnome.shell.extensions.liquid-widgets-public',
            'url':'https://github.com/NyongCho/gnome-widget'}).encode(),
        'extension.js': b'import St from "gi://St";\nexport default class Extension {}\n',
        'prefs.js': b'import Adw from "gi://Adw";\nexport default class Preferences {}\n',
        'calendar-worker.js': b'#!@GJS@ -m\nawait import("./engine-ABCDEFGH.js");\n',
        'engine-ABCDEFGH.js': b'// vendor/ical/module.js\nexport const calendar = {};\n',
        'stylesheet.css': b'.card { color: white; }\n',
        'schemas/org.gnome.shell.extensions.liquid-widgets-public.gschema.xml':
            b'<schemalist><schema id="org.gnome.shell.extensions.liquid-widgets-public" path="/org/gnome/shell/extensions/liquid-widgets-public/"/></schemalist>',
        'schemas/gschemas.compiled': b'GVariant',
        'LICENSE': b'GNU GENERAL PUBLIC LICENSE\nVersion 3, 29 June 2007\n',
        'THIRD_PARTY_NOTICES.md': b'Third-party source and notices\n',
        'licenses/ical-MPL-2.0.txt': b'Mozilla Public License Version 2.0\n',
        'licenses/timezones.txt': b'IANA public domain\n',
        'licenses/ajv-MIT.txt': b'MIT License\n',
        'licenses/ajv-formats-MIT.txt': b'MIT License\n',
    }


class PublicPackage(unittest.TestCase):
    def test_import_text_inside_literals_or_comments_is_not_executable(self):
        source=b'''const helper = {};
helper.code = 'require("ajv/dist/runtime/ucs2length").default';
// import fs from "node:fs";
/* await import("node:fs"); */
export default helper;
'''
        validate_public(artifact()|{'extension.js':source})

    def test_readable_worker_closure_is_accepted(self):
        validate_public(artifact())

    def test_unknown_files_cannot_leak_into_public_zip(self):
        for name,body in [('liquid-widgets-daemon',b'\x7fELF'),('native.so',b'library'),
                ('liquid-widgets.service',b'[Service]'),('install.py',b'print(1)'),
                ('tests/fixture.js',b'fixture'),('settings.json',b'private'),
                ('calendar-raw.ics',b'BEGIN:VCALENDAR'),('../escape',b'bad')]:
            with self.subTest(name=name),self.assertRaises(ValueError):
                validate_public(artifact()|{name:body})

    def test_executable_cannot_hide_behind_allowed_filename(self):
        for magic in [b'\x7fELF',b'MZ\x90\x00',b'\x00asm']:
            with self.subTest(magic=magic),self.assertRaises(ValueError):
                validate_public(artifact()|{'extension.js':magic})

    def test_node_and_cross_process_imports_are_rejected(self):
        cases=[('extension.js','Gtk'),('extension.js','Gdk'),('extension.js','Adw'),
               ('prefs.js','St'),('prefs.js','Clutter'),('prefs.js','Meta'),('prefs.js','Shell')]
        for entry,library in cases:
            with self.subTest(entry=entry,library=library),self.assertRaises(ValueError):
                validate_public(artifact()|{entry:f'import x from "gi://{library}?version=1";'.encode()})
        for source in ['import fs from "node:fs";', 'await import("fs");', 'import "npm:thing";',
                       'const fs = require("node:fs");']:
            with self.subTest(source=source),self.assertRaises(ValueError):
                validate_public(artifact()|{'calendar-worker.js':artifact()['calendar-worker.js']+source.encode()})

    def test_ui_cannot_load_worker_engine_directly_or_through_chunk(self):
        cases=[{'extension.js':b'import "./engine-ABCDEFGH.js";'},
               {'prefs.js':b'await import("./engine-ABCDEFGH.js");'},
               {'extension.js':b'import "./chunk-ABCDEFGH.js";',
                'chunk-ABCDEFGH.js':b'import "./engine-ABCDEFGH.js";'},
               {'extension.js':b'// src/calendar-worker/engine.ts\nfunction expandCalendar() {}'}]
        for changes in cases:
            with self.subTest(changes=changes),self.assertRaises(ValueError):
                validate_public(artifact()|changes)

    def test_worker_header_schema_metadata_and_closure_are_required(self):
        cases=[{'calendar-worker.js':b'#!/usr/bin/gjs -m\n'},
               {'calendar-worker.js':b'#!@GJS@ -m\nimport "./engine-MISSING0.js";'},
               {'chunk-UNUSED00.js':b'export const unused = 1;'},
               {'schemas/org.gnome.shell.extensions.liquid-widgets-public.gschema.xml':b'<schemalist><schema id="wrong"/></schemalist>'}]
        for changes in cases:
            with self.subTest(changes=changes),self.assertRaises(ValueError):
                validate_public(artifact()|changes)
        for key,value in [('uuid','liquid-widgets@local'),('shell-version',['99']),
                          ('url','https://example.invalid'),('settings-schema','wrong')]:
            files=artifact();meta=json.loads(files['metadata.json']);meta[key]=value;files['metadata.json']=json.dumps(meta).encode()
            with self.subTest(key=key),self.assertRaises(ValueError):validate_public(files)

    def test_missing_license_is_not_release_ready(self):
        files=artifact();del files['LICENSE']
        with self.assertRaises(ValueError):validate_public(files)
        validate_public(files,release=False)


class PublicPackagingCommand(unittest.TestCase):
    def setUp(self):
        spec=importlib.util.spec_from_file_location('liquid_package',Path(__file__).resolve().parents[1]/'scripts/package.py')
        self.package=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.package)
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
        self.commands=[]
        self.addCleanup(patch.stopall)
        patch.object(self.package,'ROOT',self.root).start()
        patch.object(self.package,'run',side_effect=lambda args:self.commands.append(args)).start()
        repo=Path(__file__).resolve().parents[1]
        files=artifact()
        for name,data in files.items():
            if name.startswith('licenses/') or name in {'LICENSE','THIRD_PARTY_NOTICES.md'}:continue
            path=self.root/'extension/dist-gjs'/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data)
        (self.root/'extension/editions.json').write_bytes((repo/'extension/editions.json').read_bytes())
        for name,target in {'LICENSE':'LICENSE','THIRD_PARTY_NOTICES.md':'THIRD_PARTY_NOTICES.md',
             'licenses/ical-MPL-2.0.txt':'extension/vendor/ical/LICENSE',
             'licenses/timezones.txt':'extension/vendor/timezones/LICENSE',
             'licenses/ajv-MIT.txt':'extension/node_modules/ajv/LICENSE',
             'licenses/ajv-formats-MIT.txt':'extension/node_modules/ajv-formats/LICENSE'}.items():
            path=self.root/target;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(files[name])

    def test_public_command_builds_valid_zip_without_cargo(self):
        self.package.main(['--edition','gjs'])
        self.assertTrue(self.commands)
        self.assertTrue(all('cargo' not in command for command in self.commands))
        archive=self.root/'dist/liquid-widgets-public/liquid-widgets.shell-extension.zip'
        with zipfile.ZipFile(archive) as bundle:
            validate_public({name:bundle.read(name) for name in bundle.namelist()})
        self.assertFalse((archive.parent/'install.py').exists())
        self.assertFalse((archive.parent/'liquid-widgets-daemon').exists())

    def test_release_without_license_fails_before_build(self):
        (self.root/'LICENSE').unlink()
        with self.assertRaises(SystemExit),redirect_stderr(io.StringIO()):self.package.main(['--edition','gjs'])
        self.assertEqual(self.commands,[])

    def test_fixture_output_is_rejected_before_archive_creation(self):
        path=self.root/'extension/dist-gjs/tests/fixture.js';path.parent.mkdir();path.write_text('fixture')
        with self.assertRaises(ValueError):self.package.main(['--edition','gjs'])
        self.assertFalse((self.root/'dist/liquid-widgets-public/liquid-widgets.shell-extension.zip').exists())


class PublicCheckSelection(unittest.TestCase):
    def test_public_check_completes_when_cargo_is_unavailable(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);scripts=root/'scripts';scripts.mkdir();(root/'tests').mkdir();(root/'bin').mkdir()
            shutil.copy2(Path(__file__).resolve().parents[1]/'scripts/check.sh',scripts/'check.sh')
            log=root/'commands.log'
            stub='#!/bin/sh\nprintf "%s\\n" "$*" >> "$LIQUID_COMMAND_LOG"\n[ "$1" != cargo ]\n'
            for name in ['dev','test-ipc.py','test-calendar-parity.py','test-public-backend.py']:
                path=scripts/name;path.write_text(stub);path.chmod(0o755)
            (scripts/'check-build.py').write_text('')
            (root/'tests/test_install.py').write_text('import unittest\nclass Available(unittest.TestCase):\n def test_fixture(self): pass\n')
            (root/'bin/gjs').write_text(stub);(root/'bin/gjs').chmod(0o755)
            result=subprocess.run(['sh',str(scripts/'check.sh'),'--edition','gjs'],cwd=root,
                env=os.environ|{'PATH':str(root/'bin')+os.pathsep+os.environ['PATH'],'LIQUID_COMMAND_LOG':str(log)},capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stdout+result.stderr)
            commands=log.read_text().splitlines()
            self.assertTrue(any('--edition gjs' in command for command in commands),commands)
            self.assertFalse(any(command.startswith('cargo ') for command in commands),commands)


if __name__=='__main__':unittest.main()
