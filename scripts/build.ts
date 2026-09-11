import { build } from 'esbuild';
import { mkdir, cp, readFile, writeFile } from 'node:fs/promises';
import { validateDataset } from '../src/shared/domains';

const dataset = validateDataset(JSON.parse(await readFile('data/domains.json', 'utf8')));
await mkdir('dist', { recursive: true });
await cp('extension', 'dist', { recursive: true });
await cp('UNLICENSE', 'dist/UNLICENSE');
await writeFile('dist/domains.json', JSON.stringify(dataset));
await build({ entryPoints: ['src/worker.ts', 'src/ui.ts'], outdir: 'dist', bundle: true, format: 'esm',
  platform: 'browser', target: 'chrome120', minify: true, legalComments: 'eof' });
await writeFile('dist/THIRD_PARTY_NOTICES.txt', await readFile('node_modules/tldts/LICENSE', 'utf8'));
console.log(`Built dist/ with ${dataset.rules.length} approved domain rules (${dataset.version}).`);
