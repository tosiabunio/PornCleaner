import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import robotsParser from 'robots-parser';
import { load } from 'cheerio';
import { assemble, extractListings, extractReviewDestination, EXCLUDED_PATHS, REDIRECTORS, SOURCE, type Candidate, type Evidence } from './collection';
import { Client } from './network';
import { validateRules } from '../src/shared/domains';

const { values } = parseArgs({ options: {
  'listing-selector': { type: 'string', default: 'li.category-item, .thumbs-list-content .review-card[data-external-link]' }, 'destination-selector': { type: 'string', default: 'a.link-analytics[href]' },
  'max-pages': { type: 'string', default: '250' }, snapshot: { type: 'string' },
  reprocess: { type: 'string' },
  url: { type: 'string', default: SOURCE }, seed: { type: 'boolean', default: false },
  output: { type: 'string', default: 'data/candidate.json' }, inspect: { type: 'boolean' }, help: { type: 'boolean' }
} });
if (values.help) {
  console.log('npm run scrape -- --inspect (read source structure without creating a candidate)\nnpm run scrape -- --listing-selector "<verified source listing selector>" [--destination-selector "a[href]"] [--max-pages 100]\nOffline: add --snapshot saved-page.html --url https://theporndude.com/...\nStarter: --seed (rebuilds the reviewed research snapshot, no network)');
  process.exit(0);
}
const maxPages = Number(values['max-pages']);
if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 2000) throw new Error('max-pages must be between 1 and 2000.');
let previous = [];
try { previous = JSON.parse(await readFile('data/domains.json', 'utf8')).rules; } catch { /* first collection */ }
const exclusions = JSON.parse(await readFile('data/exclusions.json', 'utf8')).domains;
const wholeSites = validateRules(JSON.parse(await readFile('data/whole-site-domains.json', 'utf8')).domains
  .map((domain: string) => ({ domain, includeSubdomains: true }))).map(rule => rule.domain);
const evidence: Evidence[] = []; const pages: string[] = []; const unresolved: string[] = []; const errors: string[] = [];
const carriedExclusions: Candidate['excluded'] = [];
const client = new Client();
const robots = new Map<string, ReturnType<typeof robotsParser>>();
const resolved = new Map<string, string | undefined>();
const reviewedPages = new Set<string>();
async function allowed(url: string) {
  const origin = new URL(url).origin;
  if (!robots.has(origin)) {
    const reply = await client.get(`${origin}/robots.txt`);
    if (reply.status !== 200 && reply.status !== 404) throw new Error(`Cannot establish robots rules for ${origin}: HTTP ${reply.status}.`);
    if (reply.status === 200 && (/text\/html/i.test(reply.contentType) || /<html|cf-chl-/i.test(reply.body))) throw new Error('robots.txt returned HTML or a challenge.');
    robots.set(origin, robotsParser(`${origin}/robots.txt`, reply.status === 404 ? '' : reply.body));
  }
  if (robots.get(origin)!.isAllowed(url, 'PornCleanerDomainCollector') === false) throw new Error(`robots.txt disallows ${url}`);
}
async function destination(url: string): Promise<string | undefined> {
  if (resolved.has(url)) return resolved.get(url);
  const initial = url;
  const seen = new Set<string>();
  for (let i = 0; i < 5; i++) {
    const parsed = new URL(url);
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) return;
    if (!REDIRECTORS.includes(parsed.hostname)) { resolved.set(initial, parsed.hostname); return parsed.hostname; }
    if (seen.has(url)) return; seen.add(url);
    await allowed(url);
    const reply = await client.get(url);
    if (!reply.location || reply.status < 300 || reply.status >= 400) { resolved.set(initial, undefined); return; }
    url = new URL(reply.location, url).href;
  }
}
try {
  if (values.reprocess) {
    const saved = JSON.parse(await readFile(values.reprocess, 'utf8'));
    evidence.push(...saved.evidence); pages.push(...saved.pages);
    unresolved.push(...saved.unresolved); errors.push(...saved.errors);
    carriedExclusions.push(...saved.excluded);
  } else if (values.seed) {
    const snapshot = JSON.parse(await readFile('data/source-evidence.json', 'utf8'));
    evidence.push(...snapshot.evidence); pages.push(...snapshot.pages);
    unresolved.push(...snapshot.unresolved);
  } else {
    // First establish access. Defaults were verified against source HTML on
    // 2026-09-11; overrides support later template changes and saved fixtures.
    if (!values.snapshot) await allowed(values.url!);
    if (values.inspect) {
      const response = await client.get(values.url!);
      if (response.status !== 200) throw new Error(`Source returned HTTP ${response.status}.`);
      if (/cf-chl-|Just a moment\.\.\./i.test(response.body)) throw new Error('Source returned a challenge page.');
      await writeFile('.cache/source-inspect.html', response.body);
      const $ = load(response.body); const counts = new Map<string, number>();
      $('a[href]').each((_, link) => {
        const chain = [link, ...$(link).parents().toArray().slice(0, 3)];
        for (const node of chain) { const label = `${node.tagName}.${($(node).attr('class') ?? '').trim().replace(/\s+/g, '.')}`; counts.set(label, (counts.get(label) ?? 0) + 1); }
      });
      console.log(JSON.stringify({ savedHTML: '.cache/source-inspect.html', anchorCount: $('a[href]').length,
        commonContainers: [...counts].sort((a, b) => b[1] - a[1]).slice(0, 30) }, null, 2));
      process.exit(0);
    }
    if (!values['listing-selector']) throw new Error('Supply --listing-selector after inspecting the source HTML. No source-template guess is used.');
    const start = new URL(values.url!); start.hash = '';
    if (EXCLUDED_PATHS.has(start.pathname.replace(/\/$/, ''))) throw new Error('This category is outside the configured content scope.');
    const queue = [start.href]; const visited = new Set<string>();
    while (queue.length && pages.length < maxPages) {
      const page = queue.shift()!; if (visited.has(page)) continue; visited.add(page);
      if (new URL(page).origin !== new URL(SOURCE).origin) throw new Error('Crawl URLs must remain on the source directory.');
      let html: string;
      if (values.snapshot) html = await readFile(values.snapshot, 'utf8');
      else {
        await allowed(page); const response = await client.get(page);
        if (response.status !== 200) throw new Error(`Source returned HTTP ${response.status}.`);
        html = response.body;
      }
      const extracted = extractListings(html, page, values['listing-selector']!, values['destination-selector']!);
      pages.push(page);
      // The homepage mixes content with dating services. Use it for discovery;
      // collect domains from the scoped category pages with structured metadata.
      for (const url of new URL(page).pathname === '/' ? [] : extracted.destinations) {
        try {
          const domain = await destination(url);
          if (domain) evidence.push({ domain, sourceUrl: page, method: REDIRECTORS.includes(new URL(url).hostname) ? 'redirect-header' : 'listing-destination' });
          else unresolved.push(url);
        } catch { unresolved.push(url); resolved.set(url, undefined); }
      }
      if (new URL(page).pathname !== '/') {
        for (const reviewUrl of extracted.internal) {
          if (reviewedPages.has(reviewUrl)) continue;
          reviewedPages.add(reviewUrl);
          try {
            if (!/^\/\d+\//.test(new URL(reviewUrl).pathname)) throw new Error('Not a recognized review URL.');
            await allowed(reviewUrl); const response = await client.get(reviewUrl);
            if (response.status !== 200) throw new Error('Review unavailable.');
            const domain = await destination(extractReviewDestination(response.body, reviewUrl));
            if (!domain) throw new Error('Unresolved review destination.');
            evidence.push({ domain, sourceUrl: reviewUrl, method: 'review-destination' });
          } catch { unresolved.push(reviewUrl); }
        }
      }
      console.log(`Collected page ${pages.length}; ${evidence.length} destination records; ${new Set(unresolved).size} unresolved links.`);
      if (values.snapshot) break;
      queue.push(...extracted.pages.filter(url => !visited.has(url)));
    }
    if (queue.length && !values.snapshot) errors.push('Page limit reached; collection is incomplete.');
    if (!evidence.length) errors.push('No valid destination domains were extracted.');
    evidence.push({ domain: 'theporndude.com', sourceUrl: SOURCE, method: 'explicit-source-directory' });
  }
} catch (error) { errors.push(error instanceof Error ? error.message : 'Collection failed.'); }
const candidate = assemble(evidence, previous, exclusions, {
  coverage: values.seed ? 'Reviewed homepage sample. Limited first-category coverage.' : `Collected from ${pages.length} directory pages. Shared platforms and non-content categories excluded; unresolved listings may be missing.`,
  pages, unresolved: [...new Set(unresolved)], errors
}, wholeSites);
candidate.excluded.push(...carriedExclusions);
await mkdir('data', { recursive: true });
await writeFile(values.output!, JSON.stringify(candidate, null, 2) + '\n');
console.log(JSON.stringify({ pages: pages.length, rules: candidate.rules.length, unresolved: candidate.unresolved.length,
  excluded: candidate.excluded.length, added: candidate.diff.added.length, removed: candidate.diff.removed.length, errors }, null, 2));
if (errors.length) process.exitCode = 1;
