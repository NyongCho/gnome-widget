"""Load the real glass effect from both editions in the same GJS process."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class GlassEditions(unittest.TestCase):
    def test_both_registration_orders(self):
        with tempfile.TemporaryDirectory(prefix='liquid-glass-editions-') as temporary:
            directory = Path(temporary)
            build = '''
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
const editions = JSON.parse(await readFile('editions.json', 'utf8'));
for (const name of ['rust', 'gjs'])
    await build({
        entryPoints: ['src/effects/glass.ts'],
        outfile: `${process.argv[1]}/${name}.js`,
        bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
        external: ['gi://*'], loader: { '.glsl': 'text' },
        define: { __LIQUID_EDITION__: JSON.stringify(editions[name]) },
    });
'''
            subprocess.run([str(ROOT/'scripts/dev'), 'node', '--input-type=module',
                            '-e', build, temporary], cwd=ROOT/'extension', check=True, timeout=30)
            paths = list(Path('/usr/lib').glob('*/mutter-18/Clutter-18.typelib'))
            paths += list(Path('/usr/lib').glob('mutter-18/Clutter-18.typelib'))
            env = os.environ.copy()
            for key in ['GI_TYPELIB_PATH', 'LD_LIBRARY_PATH']:
                env[key] = os.pathsep.join([*(str(path.parent) for path in paths), env.get(key, '')])
            for order in [('rust', 'gjs'), ('gjs', 'rust')]:
                with self.subTest(order=order):
                    probe = directory/'probe.js'
                    probe.write_text('''
import GObject from 'gi://GObject';
const types = [];
for (const uri of ''' + json.dumps([(directory/f'{name}.js').as_uri() for name in order]) + ''') {
    const { GlassEffect } = await import(uri);
    const effect = new GlassEffect();
    types.push(GObject.type_name(GlassEffect.$gtype));
    effect.release();
}
if (types[0] === types[1]) throw new Error('Editions share a GType');
print('PASS both editions registered and instantiated');
''')
                    result = subprocess.run(['gjs', '-m', str(probe)], env=env,
                                            capture_output=True, text=True, timeout=15)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertIn('PASS both editions', result.stdout)
