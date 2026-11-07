"""Content policy for the standalone public extension ZIP."""
import json
import re
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path,PurePosixPath

SCHEMA='org.gnome.shell.extensions.liquid-widgets-public'
SCHEMA_FILE=f'schemas/{SCHEMA}.gschema.xml'
REQUIRED={'extension.js','prefs.js','calendar-worker.js','metadata.json','stylesheet.css',
          SCHEMA_FILE,'THIRD_PARTY_NOTICES.md',
          'licenses/ical-MPL-2.0.txt','licenses/timezones.txt','licenses/ajv-MIT.txt',
          'licenses/ajv-formats-MIT.txt'}
CHUNK=re.compile(r'(?:engine|chunk)-[A-Z0-9]{8}\.js')
ENGINE_SOURCE=re.compile(r'(?m)^\s*//\s*(?:src/calendar-worker/|vendor/(?:ical|timezones)/)')


def module_imports(files):
    # Use the existing development compiler's parser. A textual scan confuses
    # quotes in regular expressions and Ajv's non-executable .code metadata.
    root=Path(__file__).resolve().parent.parent
    result=subprocess.run([str(root/'scripts/dev'),'node',str(root/'extension/scripts/inspect-imports.mjs')],
        input=json.dumps({name:data.decode('utf-8') for name,data in files.items() if name.endswith('.js')}),
        capture_output=True,text=True,check=True)
    return json.loads(result.stdout)


def validate_process_imports(files,dependencies=None):
    """Follow emitted local imports as well as imports in each UI entry point."""
    dependencies=module_imports(files) if dependencies is None else dependencies
    def visit(name,forbidden,seen):
        if name in seen:return
        seen.add(name)
        for dependency in dependencies[name]:
            if dependency.startswith('./'):
                target=str(PurePosixPath(name).parent/dependency[2:])
                if target not in files:raise ValueError(f'Missing imported file: {target}')
                visit(target,forbidden,seen)
            elif any(re.match(rf'gi://{library}(?:\?|$)',dependency) for library in forbidden):
                raise ValueError(f'Cross-process library in {name}: {dependency}')
            elif 'St' in forbidden and dependency.startswith('resource:///org/gnome/shell/ui/'):
                raise ValueError(f'Shell UI in preferences: {dependency}')
        return seen
    for name,forbidden in [('extension.js',['Gtk','Gdk','Adw']),('prefs.js',['St','Clutter','Meta','Shell'])]:
        visit(name,forbidden,set())


def public_runtime_files(directory):
    """Reject surplus build output; test builds cannot become release ZIPs."""
    files={str(path.relative_to(directory)):path.read_bytes() for path in directory.rglob('*') if path.is_file()}
    # Local builds need this cache; GNOME's installer compiles the shipped XML.
    files.pop('schemas/gschemas.compiled',None)
    for name in files:
        if name not in REQUIRED|{'LICENSE'} and not CHUNK.fullmatch(name):
            raise ValueError(f'Unexpected public build output: {name}')
    return files


def validate_public(files,release=True):
    required=REQUIRED|({'LICENSE'} if release else set())
    if missing:=required-files.keys():raise ValueError(f'Missing public files: {sorted(missing)}')
    for name,data in files.items():
        if name not in REQUIRED|{'LICENSE'} and not CHUNK.fullmatch(name) and not re.fullmatch(r'shaders/[a-z][a-z0-9-]*\.glsl',name):
            raise ValueError(f'Unexpected public file: {name}')
        if data.startswith((b'\x7fELF',b'MZ',b'\x00asm')):raise ValueError(f'Executable content: {name}')
        data.decode('utf-8')
    meta=json.loads(files['metadata.json'])
    for key,value in {'uuid':'liquid-widgets@nyongcho.github.io','settings-schema':SCHEMA,
                      'shell-version':['50'],'url':'https://github.com/NyongCho/gnome-widget'}.items():
        if meta.get(key)!=value:raise ValueError(f'Invalid metadata: {key}')
    if not meta.get('name') or not meta.get('description'):raise ValueError('Missing display metadata')
    schema=ET.fromstring(files[SCHEMA_FILE]).find('schema')
    if schema is None or schema.get('id')!=SCHEMA or schema.get('path')!='/org/gnome/shell/extensions/liquid-widgets-public/':
        raise ValueError('Schema ID/path mismatch')
    if files['calendar-worker.js'].splitlines()[0]!=b'#!@GJS@ -m':raise ValueError('Worker must have the standalone GJS header')
    graph={};dependencies=module_imports(files)
    for name,data in files.items():
        if not name.endswith('.js'):continue
        graph[name]=[]
        for dependency in dependencies[name]:
            if dependency.startswith('./') and '..' not in PurePosixPath(dependency).parts:
                target=str(PurePosixPath(name).parent/dependency[2:])
                if target not in files:raise ValueError(f'Missing imported file: {target}')
                graph[name].append(target)
            elif not dependency.startswith(('gi://','resource://')) and dependency not in {'cairo','system'}:
                raise ValueError(f'Unsupported runtime import in {name}: {dependency}')
    validate_process_imports(files,dependencies)
    def closure(name,seen):
        if name in seen:return seen
        seen.add(name)
        for dependency in graph.get(name,[]):closure(dependency,seen)
        return seen
    for entry in ['extension.js','prefs.js']:
        for name in closure(entry,set()):
            if name=='calendar-worker.js' or name.startswith('engine-') or ENGINE_SOURCE.search(files[name].decode()):
                raise ValueError(f'Calendar computation loaded by UI: {name}')
    reachable=set().union(*(closure(entry,set()) for entry in ['extension.js','prefs.js','calendar-worker.js']))
    if set(graph)-reachable:raise ValueError(f'Unused JavaScript: {sorted(set(graph)-reachable)}')
