import { mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
await mkdir('artifacts', { recursive: true });
const filename = `porncleaner-${manifest.version}.zip`;
const temporary = await mkdtemp('artifacts/.package-');
try {
  // Build a fresh archive so removed build files cannot survive a later release.
  const archive = path.resolve(temporary, filename);
  execFileSync('/usr/bin/zip', ['-q', '-r', archive, '.'], { cwd: 'dist' });
  await rename(archive, `artifacts/${filename}`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
console.log(`Packaged artifacts/${filename}`);
