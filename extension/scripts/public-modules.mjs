import {existsSync} from 'node:fs';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {dirname, relative, resolve} from 'node:path';
import {format} from 'prettier';
import {parsers} from 'prettier/plugins/babel';
import {assertCalendarIsolated} from '../src/shared/buildPolicy.ts';

const entries = {
    'src/extension.ts': 'extension.js',
    'src/prefs.ts': 'prefs.js',
    'src/calendar-worker/main.ts': 'calendar-worker.js',
};
const outputName = file => entries[file] ?? (file.endsWith('.ts')
    ? file.replace(/\.ts$/, '.js') : file.endsWith('.js') ? file : `${file}.js`);

export async function buildPublicModules(edition, outdir) {
    const root = process.cwd();
    const formatting = JSON.parse(await readFile('.prettierrc.json', 'utf8'));
    const overrides = {
        'src/backend/factory.ts': "export {createWidgetDataSession} from '../data/runtime.js';",
        'src/prefs/factory.ts': "export {createPreferencesDataSession} from './dataSession.js';",
        'src/edition.ts': `export const EDITION = ${JSON.stringify(edition)};`,
    };
    const outputs = {};
    const visited = new Set();
    const compiled = await mkdtemp(`${tmpdir()}/liquid-typescript-`);
    async function write(name, contents) {
        await mkdir(dirname(`${outdir}/${name}`), {recursive: true});
        await writeFile(`${outdir}/${name}`, contents);
    }
    function localFile(from, specifier) {
        if (/^(gi:|resource:)/.test(specifier) || ['cairo', 'system'].includes(specifier))
            return null;
        if (!specifier.startsWith('.')) throw new Error(`Unsupported import: ${specifier}`);
        let path = resolve(dirname(resolve(from)), specifier);
        if (!path.startsWith(`${root}/`)) throw new Error(`Import escapes extension: ${specifier}`);
        if (!existsSync(path) && path.endsWith('.js')) path = path.slice(0, -3) + '.ts';
        if (!existsSync(path)) throw new Error(`Missing module: ${path}`);
        return relative(root, path);
    }
    async function emit(file) {
        if (visited.has(file)) return;
        visited.add(file);
        const name = outputName(file);
        const source = overrides[file] ?? await readFile(file.endsWith('.ts')
            ? `${compiled}/${file.replace(/\.ts$/, '.js')}` : file, 'utf8');
        let code;
        if (file.endsWith('.json')) {
            await write(file, source);
            // JSON import attributes are unavailable in GJS. This data is worker-only.
            code = `import Gio from 'gi://Gio';
                const file = Gio.File.new_for_uri(import.meta.url.slice(0, -3));
                const [, bytes] = file.load_contents(null);
                export default JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));`;
        } else if (file.endsWith('.glsl')) {
            await write(file, source);
            code = 'export default `' + source.replaceAll('\\', '\\\\')
                .replaceAll('`', '\\`').replaceAll('${', '\\${') + '`;';
        } else {
            code = source;
        }
        const parsed = parsers.babel.parse(code, {});
        const operands = new Map();
        const edits = [];
        function inspect(node) {
            if (['ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration'].includes(node.type) && node.source) {
                operands.set(node.source, node.source.value);
                if (node.attributes?.length) edits.push([node.source.end, node.end, ';']);
            }
            if (node.type === 'ImportExpression' || node.type === 'CallExpression' && node.callee.type === 'Import') {
                const argument = node.source ?? node.arguments[0];
                if (argument?.type !== 'StringLiteral')
                    throw new Error(`Nonliteral module import in ${file}`);
                operands.set(argument, argument.value);
            }
            for (const value of Object.values(node)) {
                if (Array.isArray(value)) value.filter(child => child?.type).forEach(inspect);
                else if (value?.type) inspect(value);
            }
        }
        inspect(parsed);
        const imports = [];
        for (const [operand, specifier] of operands) {
            const dependency = localFile(file, specifier);
            if (dependency === null) {
                imports.push({path: specifier, external: true});
                continue;
            }
            await emit(dependency);
            const target = outputName(dependency);
            let rewritten = relative(dirname(name), target);
            if (!rewritten.startsWith('.')) rewritten = `./${rewritten}`;
            edits.push([operand.start, operand.end, JSON.stringify(rewritten)]);
            imports.push({path: `${outdir}/${target}`});
        }
        for (const [start,end,replacement] of edits.sort((a,b) => b[0]-a[0]))
            code = code.slice(0,start) + replacement + code.slice(end);
        code = await format(code, {...formatting, parser: 'babel'});
        if (file === 'src/calendar-worker/main.ts') code = '#!@GJS@ -m\n' + code;
        await write(name, code);
        outputs[`${outdir}/${name}`] = {
            entryPoint: entries[file] ? file : undefined,
            inputs: {[file]: {}}, imports,
        };
    }
    try {
        execFileSync('node_modules/.bin/tsc', ['--ignoreConfig', '--noCheck', '--target', 'ES2022',
            '--module', 'ESNext', '--moduleResolution', 'Bundler', '--resolveJsonModule', 'true',
            '--verbatimModuleSyntax', 'true', '--outDir', compiled, '--rootDir', '.',
            ...Object.keys(entries), 'src/data/runtime.ts', 'src/prefs/dataSession.ts'],
            {stdio:'pipe', encoding:'utf8'});
        for (const entry of Object.keys(entries)) await emit(entry);
        assertCalendarIsolated({outputs});
    } finally { await rm(compiled, {recursive:true, force:true}); }
}
