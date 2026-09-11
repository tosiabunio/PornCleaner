import { build } from 'esbuild';
import { mkdir, mkdtemp, cp, readFile, writeFile, rm, rename } from 'node:fs/promises';
import path from 'node:path';
import { validateDataset } from '../src/shared/domains';

const dataset = validateDataset(JSON.parse(await readFile('data/domains.json', 'utf8')));
await mkdir('.cache', { recursive: true });
const output = await mkdtemp('.cache/build-');
try {
  await cp('extension', output, { recursive: true });
  await cp('UNLICENSE', path.join(output, 'UNLICENSE'));
  await writeFile(path.join(output, 'domains.json'), JSON.stringify(dataset));
  await build({ entryPoints: ['src/worker.ts', 'src/ui.ts'], outdir: output, bundle: true, format: 'esm',
    platform: 'browser', target: 'chrome120', minify: true, legalComments: 'eof' });
  await writeFile(path.join(output, 'THIRD_PARTY_NOTICES.txt'), await readFile('node_modules/tldts/LICENSE', 'utf8'));
  // Publish only a complete, fresh build. Removed source files cannot linger.
  await rm('dist', { recursive: true, force: true });
  await rename(output, 'dist');
} finally {
  await rm(output, { recursive: true, force: true });
}
console.log(`Built dist/ with ${dataset.rules.length} approved domain rules (${dataset.version}).`);
