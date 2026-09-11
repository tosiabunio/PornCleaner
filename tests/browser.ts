import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { BrowserContext, Page } from 'playwright';
import type { Engine } from '../src/shared/engine';

process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.resolve('.browsers');
const { chromium } = await import('playwright');
type Status = ReturnType<Engine['status']>;
const root = await mkdtemp(path.join(tmpdir(), 'porncleaner-browser-test-'));
const profile = path.join(root, 'profile');
const extracted = path.join(root, 'download');
const extension = path.join(extracted, 'PornCleaner', 'Chrome');
const seeder = path.join(root, 'seeder');
await mkdir(extracted);
execFileSync('/usr/bin/unzip', ['-q', path.resolve('artifacts/porncleaner-chrome.zip'), '-d', extracted]);
await mkdir(seeder);
await mkdir('artifacts', { recursive: true });
await writeFile(path.join(seeder, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'PornCleaner isolated test seeder', version: '1.0',
  permissions: ['history'], background: { service_worker: 'seed.js' } }));
await writeFile(path.join(seeder, 'seed.js'), 'chrome.runtime.onInstalled.addListener(() => {});');
let context: BrowserContext | undefined;
const externalRequests: string[] = [];
const pageErrors: string[] = [];
const passed: string[] = [];
const pass = (name: string) => { passed.push(name); console.log(`PASS ${name}`); };
async function launch(extensionPath: string) {
  const ctx = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
    viewport: { width: 1280, height: 1000 },
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, '--disable-background-networking'] });
  ctx.on('request', req => { if (/^https?:/.test(req.url())) externalRequests.push(req.url()); });
  ctx.on('page', page => page.on('pageerror', err => pageErrors.push(err.message)));
  await ctx.route(/^https?:/, route => route.abort());
  return ctx;
}
async function worker(ctx: BrowserContext) { return ctx.serviceWorkers()[0] ?? await ctx.waitForEvent('serviceworker'); }
async function openManage(ctx: BrowserContext) {
  const sw = await worker(ctx); const id = sw.url().split('/')[2];
  const page = await ctx.newPage(); await page.goto(`chrome-extension://${id}/manage.html`);
  return { page, id };
}
async function send(page: Page, type: string, args: Record<string, unknown> = {}) {
  const response = await page.evaluate(async ({ type, args }) => chrome.runtime.sendMessage({ type, ...args }), { type, args });
  assert.equal(response.ok, true, response.error); return response.data as Status;
}
async function until<T>(read: () => Promise<T>, accepts: (value: T) => boolean, label: string, timeout = 45000): Promise<T> {
  const deadline = Date.now() + timeout;
  let value: T;
  do { value = await read(); if (accepts(value)) return value; await new Promise(resolve => setTimeout(resolve, 100)); } while (Date.now() < deadline);
  throw new Error(`Timed out: ${label}. Last state: ${JSON.stringify(value)}`);
}
async function add(page: Page, urls: string[]) {
  await page.evaluate(async entries => { for (const url of entries) await chrome.history.addUrl({ url }); }, urls);
}
async function history(page: Page) { return page.evaluate(async () => (await chrome.history.search({ text: '', startTime: 0, maxResults: 10000 })).map(item => item.url!)); }
try {
  context = await launch(seeder);
  const seedWorker = await worker(context);
  const seedURLs = Array.from({ length: 1250 }, (_, i) => `https://www.pornhub.com/__porncleaner_synthetic__/${i}`);
  const keepURLs = ['https://example.org/__porncleaner_keep__', 'https://notpornhub.example.org/__porncleaner_keep__',
    'https://pornhub.com.example.net/__porncleaner_keep__', 'https://example.com/?q=pornhub.com'];
  await seedWorker.evaluate(async urls => { for (const url of urls) await chrome.history.addUrl({ url }); }, [...seedURLs, ...keepURLs]);
  await context.close(); context = undefined;
  pass('Seeded synthetic history in a new disposable profile without visiting any websites');

  context = await launch(extension);
  let { page, id } = await openManage(context);
  const first = await until(() => send(page, 'status'), s => s.job?.state === 'complete', 'initial automatic cleanup', 90000);
  assert.equal(first.settings.enabled, true); assert.equal(first.job!.deleted, 1250);
  const remaining = await history(page); assert.ok(seedURLs.every(url => !remaining.includes(url)));
  assert.ok(keepURLs.every(url => remaining.includes(url)));
  pass('Distribution ZIP cleans 1,250 existing URLs across capped queries and preserves all control URLs');

  const future = 'https://xhamster.com/__porncleaner_synthetic__/new';
  await add(page, [future]); await until(() => history(page), urls => !urls.includes(future), 'visit cleanup');
  pass('New matching visits are automatically removed');

  await page.getByRole('button', { name: 'Pause cleaning', exact: true }).click();
  await until(() => send(page, 'status'), s => !s.settings.enabled, 'pause setting');
  const selected = 'https://pornhub.com/__porncleaner_synthetic__/manual';
  const unselected = 'https://xhamster.com/__porncleaner_synthetic__/manual';
  await add(page, [selected, unselected]);
  await page.getByRole('button', { name: 'Scan history', exact: true }).click();
  const preview = await until(() => send(page, 'status'), s => s.job?.state === 'ready', 'manual preview');
  assert.ok((await history(page)).includes(selected)); assert.ok((await history(page)).includes(unselected));
  assert.equal(preview.job!.groups.length, 2);
  await page.locator('#matches input[value="xhamster.com"]').waitFor();
  await page.locator('#matches input[value="xhamster.com"]').uncheck();
  await page.screenshot({ path: 'artifacts/manage-preview.png', fullPage: true });
  await page.getByRole('button', { name: 'Delete selected history', exact: true }).click();
  await until(() => send(page, 'status'), s => s.job?.state === 'complete', 'manual deletion');
  assert.ok(!(await history(page)).includes(selected)); assert.ok((await history(page)).includes(unselected));
  pass('Manual preview leaves history untouched and only the selected domain is deleted');

  await page.getByLabel('Domain', { exact: true }).first().fill('pornhub.com');
  await page.getByRole('button', { name: 'Keep domain', exact: true }).click();
  await until(() => send(page, 'status'), s => s.settings.exceptions.some(r => r.domain === 'pornhub.com'), 'exception save');
  await add(page, [selected]);
  await page.getByRole('button', { name: 'Resume cleaning', exact: true }).click();
  await until(() => send(page, 'status'), s => s.settings.enabled && s.job?.state === 'complete', 'resume recovery');
  assert.ok((await history(page)).includes(selected)); assert.ok(!(await history(page)).includes(unselected));
  pass('Exceptions protect matching history during recovery cleanup');

  await page.locator('#custom-domain').fill('com');
  await page.getByRole('button', { name: 'Add domain', exact: true }).click();
  await page.locator('#error:not([hidden])').waitFor();
  assert.ok((await page.locator('#error').innerText()).includes('registrable'));
  await page.locator('#custom-domain').fill('custom.example.com');
  await page.getByRole('button', { name: 'Add domain', exact: true }).click();
  await until(() => send(page, 'status'), s => s.settings.customRules.some(r => r.domain === 'custom.example.com'), 'custom domain');
  const customURL = 'https://sub.custom.example.com/__porncleaner_synthetic__/custom';
  await add(page, [customURL]); await until(() => history(page), urls => !urls.includes(customURL), 'custom rule cleanup');
  pass('Custom rules work and public suffix input is rejected');

  const cdp = await context.newCDPSession(page);
  await cdp.send('ServiceWorker.enable'); await cdp.send('ServiceWorker.stopAllWorkers');
  const awakenedURL = 'https://xhamster.com/__porncleaner_synthetic__/worker-restart';
  await add(page, [awakenedURL]); await until(() => history(page), urls => !urls.includes(awakenedURL), 'cleanup after worker restart');
  pass('Automatic cleaning resumes after forced service-worker termination');

  await send(page, 'enable', { enabled: false });
  const pausedURL = 'https://xhamster.com/__porncleaner_synthetic__/paused'; await add(page, [pausedURL]);
  const local = await page.evaluate(() => chrome.storage.local.get(null));
  assert.deepEqual(Object.keys(local), ['settings']); assert.ok(!JSON.stringify(local).includes('__porncleaner'));
  const exportResult = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'export' }));
  assert.deepEqual(Object.keys(exportResult.data).sort(), ['customRules', 'enabled', 'exceptions', 'schemaVersion']);
  pass('Persistent storage and exports contain configuration only');

  await context.close(); context = undefined;
  const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8')); manifest.version = '0.1.1';
  await writeFile(path.join(extension, 'manifest.json'), JSON.stringify(manifest));
  context = await launch(extension); ({ page, id } = await openManage(context));
  const restarted = await send(page, 'status'); assert.equal(restarted.settings.enabled, false);
  assert.ok((await history(page)).includes(pausedURL));
  pass('Pause preference survives browser restart and extension update');

  await send(page, 'enable', { enabled: true });
  await until(() => send(page, 'status'), s => s.job?.state === 'complete', 'final recovery');
  assert.ok(!(await history(page)).includes(pausedURL));
  await until(() => page.locator('#mode').innerText(), text => text === 'Cleaning is on', 'visible automatic-cleaning status');
  await page.screenshot({ path: 'artifacts/manage.png', fullPage: true });
  const popup = await context.newPage(); await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.setViewportSize({ width: 355, height: 640 });
  await popup.getByRole('button', { name: 'Pause cleaning', exact: true }).waitFor();
  await popup.locator('body').screenshot({ path: 'artifacts/popup.png' });
  await page.setViewportSize({ width: 420, height: 850 }); await page.screenshot({ path: 'artifacts/manage-mobile.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'narrow layout should not overflow');
  assert.deepEqual(pageErrors, []); assert.deepEqual(externalRequests, []);
  pass('Popup and management page render without script errors, overflow, or external requests');
  const guide = await context.newPage();
  await guide.goto(pathToFileURL(path.join(extracted, 'PornCleaner', 'START-HERE.html')).href);
  await guide.setViewportSize({ width: 1100, height: 1000 });
  await guide.getByRole('heading', { name: 'Select the Chrome folder' }).waitFor();
  assert.ok((await guide.locator('body').innerText()).includes('Cleaning starts as soon as you install.'));
  assert.ok(!(await guide.locator('body').innerText()).includes('{{VERSION}}'));
  assert.equal(await guide.locator('ol > li').count(), 4);
  await guide.screenshot({ path: 'artifacts/install-guide.png', fullPage: true });
  await guide.setViewportSize({ width: 390, height: 844 });
  assert.equal(await guide.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'installation guide should fit a narrow screen');
  await guide.screenshot({ path: 'artifacts/install-guide-mobile.png', fullPage: true });
  assert.deepEqual(pageErrors, []); assert.deepEqual(externalRequests, []);
  pass('Packaged installation guide works offline with desktop and narrow layouts');
  await writeFile('artifacts/browser-test-report.json', JSON.stringify({ passed, failed: [], browser: await context.browser()?.version(),
    distribution: 'porncleaner-chrome.zip', datasetVersion: first.dataset.version, domainCount: first.dataset.count, testedAt: new Date().toISOString() }, null, 2));
  console.log(`All ${passed.length} browser checks passed. Screenshots and report are in artifacts/.`);
} catch (error) {
  await writeFile('artifacts/browser-test-report.json', JSON.stringify({ passed, failed: [String(error)], pageErrors }, null, 2));
  throw error;
} finally {
  await context?.close();
  // This path comes only from mkdtemp above, never from a user profile setting.
  await rm(root, { recursive: true, force: true });
}
