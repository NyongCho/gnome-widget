#!/usr/bin/env python3
"""Check the two GNOME processes stay separate and metadata/schema agree."""
from pathlib import Path
import json,re,subprocess
root=Path(__file__).resolve().parent.parent
extension=root/'extension/dist'
metadata=json.loads((extension/'metadata.json').read_text())
assert metadata['uuid']=='liquid-widgets@local'
assert metadata['shell-version']==['50']
assert (extension/'schemas'/f"{metadata['settings-schema']}.gschema.xml").exists()
prefs=(extension/'prefs.js').read_text();shell=(extension/'extension.js').read_text()
assert not re.search(r'from [\'"](?:gi://(?:St|Clutter|Shell)(?:[?\'"])|resource:///org/gnome/shell/ui/)',prefs),'Shell-only import in GTK preferences'
assert not re.search(r'from [\'"]gi://(?:Gtk|Gdk|Adw)(?:[?\'"])',shell),'GTK-only import in Shell'
subprocess.run(['glib-compile-schemas','--strict','--dry-run',str(extension/'schemas')],check=True)
print('BUILD_TEST: GNOME 50 metadata/schema and Shell/GTK process isolation passed')
