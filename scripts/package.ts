import { mkdir, mkdtemp, readFile, rename, rm, cp, copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(manifest.version) || manifest.version !== pkg.version || manifest.version !== lock.version || manifest.version !== lock.packages[''].version)
  throw new Error('Package, lockfile, and extension versions must match.');
const dataset = JSON.parse(await readFile('dist/domains.json', 'utf8'));
await mkdir('artifacts', { recursive: true });
const filename = 'porncleaner-chrome.zip';
const temporary = await mkdtemp('artifacts/.package-');
try {
  const folder = path.join(temporary, 'PornCleaner');
  await mkdir(folder);
  await cp('dist', path.join(folder, 'Chrome'), { recursive: true });
  const values: Record<string, string> = { VERSION: manifest.version, MIN_CHROME: manifest.minimum_chrome_version,
    DOMAIN_COUNT: dataset.rules.length.toLocaleString('en-US') };
  for (const file of ['START-HERE.html', 'INSTALL.txt']) {
    const template = await readFile(`distribution/${file}`, 'utf8');
    const rendered = template.replace(/\{\{([A-Z_]+)\}\}/g, (_, key: string) => {
      if (!(key in values)) throw new Error(`Unknown guide placeholder: ${key}`);
      return values[key];
    });
    await writeFile(path.join(folder, file), rendered);
  }
  await writeFile(path.join(folder, 'VERSION.txt'), `PornCleaner ${manifest.version}\nDomain list: ${dataset.version}\n`);
  // Create a fresh archive so removed files cannot survive a later release.
  const archive = path.resolve(temporary, filename);
  execFileSync('/usr/bin/zip', ['-q', '-r', archive, 'PornCleaner'], { cwd: temporary });
  await rename(archive, `artifacts/${filename}`);
  // Keep the existing versioned filename available for local release archives.
  await copyFile(`artifacts/${filename}`, `artifacts/porncleaner-${manifest.version}.zip`);
  await rm('artifacts/PornCleaner', { recursive: true, force: true });
  await rename(folder, 'artifacts/PornCleaner');
  await writeFile('artifacts/release-notes.md', `Download **porncleaner-chrome.zip** from the Assets below.\n\n` +
    `1. Extract the ZIP and move the **PornCleaner** folder somewhere permanent, such as Documents.\n` +
    `2. Open **START-HERE.html** for the illustrated installation guide.\n` +
    `3. In desktop Chrome, go to \`chrome://extensions\`, enable **Developer mode**, click **Load unpacked**, and select **PornCleaner → Chrome**.\n\n` +
    `**Cleaning starts immediately**, including existing matching history. Deletions cannot be undone and may sync to your other Chrome devices. You can pause cleaning from the toolbar.\n\n` +
    `Version ${manifest.version} · ${values.DOMAIN_COUNT} domain rules · Chrome ${values.MIN_CHROME}+ on Windows, macOS, or Linux.\n\n` +
    `Keep the extracted folder in place. Updates are manual: replace files in the original Chrome folder and click Reload on the extension.\n\n` +
    `Setup uses Chrome’s menus; no build or terminal commands are needed. Choose **porncleaner-chrome.zip**, not GitHub’s automatically generated source-code archives.\n`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
console.log(`Packaged artifacts/${filename}`);
console.log('Installation guide: artifacts/PornCleaner/START-HERE.html');
