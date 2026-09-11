import test from 'node:test';
import assert from 'node:assert/strict';
import { assemble, classify, extractListings, extractReviewDestination } from '../scripts/collection';
import { isPublicIPv4 } from '../scripts/network';
const html = `<html><main><h2><a href="/category">Category</a></h2>
<ul><li class="listing"><a href="https://adult.example.com/path">Site A</a></li>
<li class="listing"><a href="https://adult.example.com/other">Site A duplicate</a></li>
<li class="listing"><a href="https://pdude.link/example">Redirect</a></li>
<li class="listing"><a href="https://reddit.com/r/example">Shared platform</a></li>
<li class="listing"><a href="/review">Internal review</a></li></ul>
<a rel="next" href="/category?page=2">Next</a></main><footer><a href="https://analytics.example.com/">Not a listing</a></footer></html>`;
test('extracts only listing links, category pages and pagination', () => {
  const result = extractListings(html, 'https://theporndude.com/', '.listing', 'a[href]');
  assert.equal(result.destinations.length, 4);
  assert.deepEqual(result.internal, ['https://theporndude.com/review']);
  assert.deepEqual(result.pages, ['https://theporndude.com/category', 'https://theporndude.com/category?page=2']);
  assert.ok(!result.destinations.some(url => url.includes('analytics')));
});
test('challenge and changed templates fail closed', () => {
  assert.throws(() => extractListings('<html>Just a moment...</html>', 'https://theporndude.com/', '.listing', 'a'), /challenge/);
  assert.throws(() => extractListings('<html><a href="https://example.com">Navigation</a></html>', 'https://theporndude.com/', '.listing', 'a'), /No listing/);
});
test('review fallback requires a unique explicit destination', () => {
  const review = '<main><a class="favicon-bar-domain" href="https://adult.example.com/">Display name</a><a href="https://ads.example.org">Ad</a></main>';
  assert.equal(extractReviewDestination(review, 'https://theporndude.com/123/site'), 'https://adult.example.com/');
  assert.throws(() => extractReviewDestination('<main><a href="https://example.com">Navigation</a></main>', 'https://theporndude.com/123/site'), /missing/);
});
test('verified category metadata takes precedence over review links and discovery excludes non-content categories', () => {
  const category = `<div class="thumbs-list-content"><div class="review-card" data-external-link="https://adult.example.com/">
    <a class="review-card-heading" href="/123/review">A display name is not a domain</a></div></div>
    <a class="category-top-card-link" href="/best-vpn-sites">VPN</a><a class="category-top-card-link" href="/best-dating-sites">Dating</a>
    <a class="category-top-card-link" href="/top-premium-sites">Category</a>`;
  const result = extractListings(category, 'https://theporndude.com/top-porn-tube-sites', '.thumbs-list-content .review-card[data-external-link]', 'a.link-analytics[href]');
  assert.deepEqual(result.destinations, ['https://adult.example.com/']); assert.deepEqual(result.internal, []);
  assert.deepEqual(result.pages, ['https://theporndude.com/top-premium-sites']);
  assert.ok(classify('onlyfans.com').reason); assert.ok(classify('www.reddit.com').reason);
  assert.ok(classify('itch.io').reason); assert.ok(classify('developer.itch.io').reason); assert.ok(classify('newgrounds.com').reason);
});
test('candidate normalizes, deduplicates, excludes shared domains, and reports diff', () => {
  const data = assemble(['www.adult.example.com', 'adult.example.com', 'old.reddit.com', 'pdude.link'].map(domain => ({ domain, sourceUrl: 'https://theporndude.com/', method: 'fixture' })),
    [{ domain: 'older.example.com', includeSubdomains: true }], [], { pages: [], coverage: 'fixture', unresolved: [], errors: [] });
  assert.deepEqual(data.rules, [{ domain: 'adult.example.com', includeSubdomains: true }]);
  assert.equal(data.excluded.length, 2); assert.deepEqual(data.diff, { added: ['adult.example.com'], removed: ['older.example.com'] });
  assert.ok(classify('tenant.github.io').reason);
});
test('only explicitly reviewed whole-site domains broaden membership hosts, preserving source evidence', () => {
  assert.deepEqual(classify('join.adult.example.com'), { domain: 'join.adult.example.com' });
  assert.deepEqual(classify('join.adult.example.com', [], ['adult.example.com']), { domain: 'adult.example.com' });
  assert.ok(classify('tenant.github.io', [], ['github.io']).reason);
  assert.ok(classify('click.example.com', ['example.com'], ['example.com']).reason);
  const result = assemble([{ domain: 'join.adult.example.com', sourceUrl: 'https://theporndude.com/category', method: 'redirect-header' }],
    [], [], { coverage: 'fixture', pages: [], unresolved: [], errors: [] }, ['adult.example.com']);
  assert.deepEqual(result.rules, [{ domain: 'adult.example.com', includeSubdomains: true }]);
  assert.equal(result.evidence[0].originalDomain, 'join.adult.example.com');
});
test('network resolver rejects loopback, private, reserved and documentation ranges', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.1', '172.16.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '198.18.0.1', '192.0.2.1', '198.51.100.1', '203.0.113.1', '224.0.0.1', '::1']) assert.equal(isPublicIPv4(ip), false, ip);
  assert.equal(isPublicIPv4('1.1.1.1'), true); assert.equal(isPublicIPv4('8.8.8.8'), true);
});
