import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

test('generated validators work in a checkout with spaces and Unicode in its path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'liquid widgets 한글 '));
    try {
        const extension = join(root, 'extension');
        await mkdir(join(extension, 'scripts'), { recursive: true });
        await cp(new URL('../../protocol/', import.meta.url), join(root, 'protocol'), {
            recursive: true,
        });
        for (const name of ['scripts/generate-validators.mjs', '.prettierrc.json'])
            await cp(new URL(`../${name}`, import.meta.url), join(extension, name));
        await symlink(
            fileURLToPath(new URL('../node_modules/', import.meta.url)),
            join(extension, 'node_modules'),
        );
        const generated = spawnSync(process.execPath, ['scripts/generate-validators.mjs'], {
            cwd: extension,
            encoding: 'utf8',
            timeout: 30000,
        });
        assert.equal(generated.status, 0, generated.stderr);
        const { dataConfig } = await import(
            pathToFileURL(join(extension, 'generated/validators/dataConfig.js')).href
        );
        assert.equal(
            dataConfig({
                schemaVersion: 1,
                revision: '00000000-0000-0000-0000-000000000000',
                calendar: { sourceId: null, enabled: false, deletionPending: false },
                weather: { sourceId: null, location: null },
                networkInterface: 'auto',
            }),
            true,
        );
        assert.equal(dataConfig({ schemaVersion: 1 }), false);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
