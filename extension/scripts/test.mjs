import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const args = process.argv.slice(2);
const files = args.length ? args.map(name => `tests/${name.replace(/^tests\//, '')}`) : (await readdir('tests')).filter(n=>n.endsWith('.test.ts')).map(n=>`tests/${n}`);
// Artifact tests regenerate shared build outputs; don't remove modules while another test imports them.
const result = spawnSync(process.execPath, ['--import','tsx','--test','--test-concurrency=1',...files], {stdio:'inherit'});
process.exit(result.status ?? 1);
