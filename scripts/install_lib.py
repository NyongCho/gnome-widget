from dataclasses import dataclass
from pathlib import Path
UUID='liquid-widgets@local'
@dataclass
class Paths:
    home: Path
    config: Path
    data: Path
    cache: Path
    @classmethod
    def for_root(cls, root):
        root=Path(root);return cls(root,root/'.config',root/'.local/share',root/'.cache')
    @property
    def extension(self):return self.data/'gnome-shell/extensions'/UUID
    @property
    def app(self):return self.home/'.local/lib/liquid-widgets'
    @property
    def unit(self):return self.config/'systemd/user/liquid-widgets.service'
    @property
    def backups(self):return self.data/'liquid-widgets/backups'

import ast,json,os,shutil,stat,tempfile,uuid,zipfile
from datetime import datetime,timezone
SERVICE='liquid-widgets.service'
SCHEMA='org.gnome.shell.extensions.liquid-widgets'
def remove(path):
    if path.is_symlink() or path.is_file():path.unlink()
    elif path.exists():shutil.rmtree(path)
def copy(source,target):
    target.parent.mkdir(parents=True,exist_ok=True)
    if source.is_dir() and not source.is_symlink():shutil.copytree(source,target,symlinks=True)
    else:shutil.copy2(source,target,follow_symlinks=False)
def unpack(archive,target):
    with zipfile.ZipFile(archive) as bundle:
        if sum(info.file_size for info in bundle.infolist())>32*1024*1024:raise ValueError('Extension archive exceeds size limit')
        for info in bundle.infolist():
            path=Path(info.filename)
            if path.is_absolute() or '..' in path.parts or stat.S_ISLNK(info.external_attr>>16):raise ValueError('Unsafe extension archive path')
        metadata=json.loads(bundle.read('metadata.json'))
        if metadata.get('uuid')!=UUID or metadata.get('shell-version')!=['50']:raise ValueError('Wrong extension or GNOME version in archive')
        for name in ['extension.js','prefs.js','schemas/'+SCHEMA+'.gschema.xml']:bundle.getinfo(name)
        bundle.extractall(target)
def activation_entry(run,key,add):
    result=run(['gsettings','get','org.gnome.shell',key]);raw=result.stdout.strip();raw=raw[4:] if raw.startswith('@as ') else raw
    values=ast.literal_eval(raw)
    if not isinstance(values,list) or not all(isinstance(v,str) for v in values):raise ValueError('Invalid GNOME extension settings')
    next_values=[v for v in values if v!=UUID]
    if add:next_values.append(UUID)
    if values!=next_values:run(['gsettings','set','org.gnome.shell',key,repr(next_values)])
def enable_for_next_login(run):
    # Preserve every other extension; new local extensions are discovered at login.
    activation_entry(run,'enabled-extensions',True);activation_entry(run,'disabled-extensions',False)
    return run(['gnome-extensions','enable',UUID],check=False).returncode==0

def install(artifacts,paths,run,activate=True):
    artifacts=Path(artifacts)
    for name in ['liquid-widgets-daemon','liquid-widgets.service']:
        if not (artifacts/name).is_file():raise ValueError('Build the distribution before installing')
    paths.extension.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.liquid-widgets-',dir=paths.extension.parent) as temp:
        staged=Path(temp)/'extension';unpack(artifacts/'liquid-widgets.shell-extension.zip',staged)
        run(['glib-compile-schemas','--strict',str(staged/'schemas')])
        backup=paths.backups/(datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+uuid.uuid4().hex[:8]);backup.mkdir(parents=True,mode=0o700)
        destinations={'extension':paths.extension,'app':paths.app,'service':paths.unit}
        existing={name for name,path in destinations.items() if path.exists() or path.is_symlink()}
        for name in existing:copy(destinations[name],backup/name)
        was_enabled=activate and 'service' in existing and run(['systemctl','--user','is-enabled',SERVICE],check=False).returncode==0
        try:
            if activate:run(['systemctl','--user','stop',SERVICE],check=False)
            remove(paths.extension);shutil.move(staged,paths.extension)
            paths.app.mkdir(parents=True,exist_ok=True)
            binary=paths.app/'liquid-widgets-daemon';temporary=paths.app/('.daemon-'+uuid.uuid4().hex);shutil.copy2(artifacts/'liquid-widgets-daemon',temporary);temporary.chmod(0o755);os.replace(temporary,binary)
            for name in ['install.py','uninstall.py','install_lib.py','liquid-widgets.shell-extension.zip','liquid-widgets.service','README.md','dependency-licenses.json']:
                source=artifacts/name;target=paths.app/name
                if source.is_file() and source.resolve()!=target.resolve():shutil.copy2(source,target)
            paths.unit.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(artifacts/'liquid-widgets.service',paths.unit)
            if activate:
                run(['systemctl','--user','daemon-reload']);run(['systemctl','--user','enable','--now',SERVICE])
                loaded=enable_for_next_login(run)
                print('Extension enabled.' if loaded and 'extension' not in existing else 'New extension code will load after logout/login. Your current session was not restarted.')
        except Exception:
            if activate:run(['systemctl','--user','disable','--now',SERVICE],check=False)
            for name,path in destinations.items():
                remove(path)
                if name in existing:copy(backup/name,path)
            if activate:
                run(['systemctl','--user','daemon-reload'],check=False)
                if was_enabled:run(['systemctl','--user','enable','--now',SERVICE],check=False)
            raise
    return backup

def uninstall(artifacts,paths,run,purge=False,activate=True):
    if activate:
        run(['gnome-extensions','disable',UUID],check=False)
        run(['systemctl','--user','stop',SERVICE],check=False)
    if purge:
        # Keep the program and retryable settings if keyring deletion fails.
        binary=Path(artifacts)/'liquid-widgets-daemon'
        if not binary.is_file():raise ValueError('Distribution binary needed to delete calendar secrets')
        run([str(binary),'--clear-calendar'])
        schemas=paths.extension/'schemas'
        if not schemas.exists():
            with tempfile.TemporaryDirectory() as temp:
                unpack(Path(artifacts)/'liquid-widgets.shell-extension.zip',Path(temp))
                run(['glib-compile-schemas','--strict',str(Path(temp)/'schemas')])
                run(['gsettings','--schemadir',str(Path(temp)/'schemas'),'reset-recursively',SCHEMA])
        else:run(['gsettings','--schemadir',str(schemas),'reset-recursively',SCHEMA])
        remove(paths.config/'liquid-widgets');remove(paths.cache/'liquid-widgets')
    if activate:
        activation_entry(run,'enabled-extensions',False);activation_entry(run,'disabled-extensions',False)
        run(['systemctl','--user','disable','--now',SERVICE],check=False)
    for path in [paths.extension,paths.app,paths.unit]:remove(path)
    if activate:run(['systemctl','--user','daemon-reload'])

def live_paths():
    home=Path.home()
    paths=Paths(home,Path(os.environ.get('XDG_CONFIG_HOME',home/'.config')),Path(os.environ.get('XDG_DATA_HOME',home/'.local/share')),Path(os.environ.get('XDG_CACHE_HOME',home/'.cache')))
    if not all(p.is_absolute() for p in [paths.home,paths.config,paths.data,paths.cache]):raise ValueError('XDG directories must be absolute')
    return paths
