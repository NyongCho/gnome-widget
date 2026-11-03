import sys,tempfile,unittest,zipfile,json,subprocess,ast
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from install_lib import Paths,install,uninstall,UUID
class Runner:
 def __init__(self,fail=None):self.calls=[];self.fail=fail;self.settings={'enabled-extensions':['keep@local',UUID],'disabled-extensions':['disabled@local']}
 def __call__(self,args,check=True):
  self.calls.append(args)
  if self.fail and self.fail(args):raise RuntimeError('injected operation failure')
  if args[:2]==['gsettings','set']:self.settings[args[3]]=ast.literal_eval(args[4])
  return subprocess.CompletedProcess(args,0,stdout=repr(self.settings[args[3]]) if args[:2]==['gsettings','get'] else '',stderr='')
class Installation(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name);self.paths=Paths.for_root(self.root/'user');self.artifacts=self.root/'artifacts';self.artifacts.mkdir();self.runner=Runner()
  (self.artifacts/'liquid-widgets-daemon').write_text('new binary')
  (self.artifacts/'uninstall.py').write_text('retained uninstaller')
  (self.artifacts/'liquid-widgets.service').write_text('[Service]\nExecStart=%h/.local/lib/liquid-widgets/liquid-widgets-daemon\n')
  with zipfile.ZipFile(self.artifacts/'liquid-widgets.shell-extension.zip','w') as z:
   for name,data in {'metadata.json':json.dumps({'uuid':UUID,'shell-version':['50'],'settings-schema':'org.gnome.shell.extensions.liquid-widgets'}),'extension.js':'new extension','prefs.js':'new preferences','schemas/org.gnome.shell.extensions.liquid-widgets.gschema.xml':'<schemalist/>','schemas/gschemas.compiled':'fixture'}.items():z.writestr(name,data)
 def old_install(self):
  self.paths.extension.mkdir(parents=True);(self.paths.extension/'extension.js').write_text('old extension');self.paths.app.mkdir(parents=True);(self.paths.app/'liquid-widgets-daemon').write_text('old binary');self.paths.unit.parent.mkdir(parents=True);self.paths.unit.write_text('old service')
 def test_backup_and_user_install_preserve_other_extensions(self):
  self.old_install();other=self.paths.extension.parent/'unrelated';other.mkdir();(other/'keep').write_text('keep')
  backup=install(self.artifacts,self.paths,self.runner,activate=False)
  self.assertEqual((self.paths.extension/'extension.js').read_text(),'new extension');self.assertEqual((backup/'extension/extension.js').read_text(),'old extension');self.assertEqual((backup/'app/liquid-widgets-daemon').read_text(),'old binary');self.assertEqual((other/'keep').read_text(),'keep');self.assertTrue((self.paths.app/'liquid-widgets-daemon').stat().st_mode&0o100);self.assertTrue((self.paths.app/'uninstall.py').is_file())
 def test_archive_traversal_rejected_before_replacing_old_install(self):
  self.old_install()
  with zipfile.ZipFile(self.artifacts/'liquid-widgets.shell-extension.zip','a') as z:z.writestr('../escape','bad')
  with self.assertRaises(ValueError):install(self.artifacts,self.paths,self.runner,activate=False)
  self.assertEqual((self.paths.extension/'extension.js').read_text(),'old extension');self.assertFalse((self.paths.extension.parent/'escape').exists())
 def test_failed_service_start_restores_previous_files(self):
  self.old_install();runner=Runner(lambda args:'enable' in args)
  with self.assertRaises(RuntimeError):install(self.artifacts,self.paths,runner)
  self.assertEqual((self.paths.extension/'extension.js').read_text(),'old extension');self.assertEqual((self.paths.app/'liquid-widgets-daemon').read_text(),'old binary');self.assertEqual(self.paths.unit.read_text(),'old service')
 def test_default_uninstall_keeps_data_and_other_extensions(self):
  self.old_install();data=self.paths.config/'liquid-widgets';data.mkdir();(data/'settings.toml').write_text('keep settings');other=self.paths.extension.parent/'other';other.mkdir();
  uninstall(self.artifacts,self.paths,self.runner,activate=False)
  self.assertFalse(self.paths.extension.exists());self.assertFalse(self.paths.app.exists());self.assertFalse(self.paths.unit.exists());self.assertTrue(other.exists());self.assertTrue(data.exists())
 def test_uninstall_removes_only_own_activation_entries(self):
  self.old_install();self.runner.settings['disabled-extensions'].append(UUID)
  uninstall(self.artifacts,self.paths,self.runner)
  self.assertEqual(self.runner.settings,{'enabled-extensions':['keep@local'],'disabled-extensions':['disabled@local']})
 def test_purge_failure_keeps_program_and_retryable_data(self):
  self.old_install();data=self.paths.config/'liquid-widgets';data.mkdir();runner=Runner(lambda args:'--clear-calendar' in args)
  with self.assertRaises(RuntimeError):uninstall(self.artifacts,self.paths,runner,purge=True)
  self.assertTrue(self.paths.app.exists());self.assertTrue(data.exists())
 def test_purge_success_removes_only_app_data(self):
  self.old_install();data=self.paths.config/'liquid-widgets';data.mkdir();cache=self.paths.cache/'liquid-widgets';cache.mkdir(parents=True);other=self.paths.cache/'other';other.mkdir()
  uninstall(self.artifacts,self.paths,self.runner,purge=True)
  self.assertFalse(data.exists());self.assertFalse(cache.exists());self.assertTrue(other.exists());self.assertTrue(any('--clear-calendar' in c for c in self.runner.calls))
if __name__=='__main__':unittest.main()
