import { load } from 'cheerio';
import { normalizeDomain, matchesHost, validateRules } from '../src/shared/domains';
import type { Rule } from '../src/shared/model';

export const SOURCE = 'https://theporndude.com/';
export const SHARED = ['reddit.com', 'twitter.com', 'x.com', 'youtube.com', 'youtu.be', 'google.com',
  'facebook.com', 'instagram.com', 'tiktok.com', 'tumblr.com', 'pinterest.com', 'discord.com', 'discord.gg',
  'twitch.tv', '4chan.org', '1337x.to', 'pixiv.net', 'furaffinity.net', 'inkbunny.net', 'fiction.live', 'fimfiction.net',
  'gumroad.com', 'fatfreecartpro.com', 'ccbill.com', 'gmbill.com', 'inet-cash.com',
  'g2afse.com', 'trk2afse.com', 'go2cloud.org', 'sjv.io', 'pxf.io', 'app.link',
  'onlyfans.com', 'fansly.com', 'fanvue.com', '9gag.com', 'deviantart.com', 'artstation.com', 'dlsite.com',
  'itch.io', 'newgrounds.com', 'fandom.com', 'anime-sharing.com', 'chatzy.com',
  'telegram.org', 't.me', 'wa.me', 'mega.nz', 'mediafire.com', 'dropbox.com', 'drive.google.com',
  'github.com', 'github.io', 'blogspot.com', 'wordpress.com', 'patreon.com', 'linktr.ee',
  'googletagmanager.com', 'google-analytics.com', 'doubleclick.net', 'staticstack.net',
  'pdude.link', 'tpd.deals', 'porndudeshop.com'];
export const REDIRECTORS = ['pdude.link'];
export const EXCLUDED_PATHS = new Set(['/betting-sites', '/best-dating-sites', '/best-escort-sites',
  '/erotic-massage-sites', '/best-adult-online-shops', '/sex-doll-shops', '/buy-used-panties',
  '/make-money-with-porn', '/best-vpn-sites', '/free-onlyfans-accounts', '/other-porn-categories', '/best-nsfw-reddit-sites']);
export interface Evidence { domain: string; originalDomain?: string; sourceUrl: string; method: string; sourceLine?: number; category?: string }
export interface Candidate {
  schemaVersion: 1; generatedAt: string; source: string; coverage: string;
  rules: Rule[]; evidence: Evidence[]; excluded: { domain: string; reason: string }[];
  unresolved: string[]; pages: string[]; errors: string[];
  diff: { added: string[]; removed: string[] };
}
export function classify(input: string, extra: string[] = [], wholeSites: string[] = []) {
  const domain = normalizeDomain(input.replace(/^www\./i, ''));
  if ([...SHARED, ...extra].some(parent => matchesHost(domain, { domain: parent, includeSubdomains: true })))
    return { domain, reason: 'Shared platform, infrastructure, or maintained exclusion' };
  // Parent coverage requires an explicit maintained review entry. A hostname
  // being registrable or having a familiar prefix does not authorize widening.
  const parent = wholeSites.find(parent => matchesHost(domain, { domain: parent, includeSubdomains: true }));
  return { domain: parent ?? domain };
}
export function extractReviewDestination(html: string, pageUrl: string): string {
  if (/cf-chl-|Just a moment\.\.\.|captcha/i.test(html.slice(0, 12000))) throw new Error('Source returned a challenge page.');
  const $ = load(html);
  const links = $('main a.favicon-bar-domain[href]');
  if (links.length !== 1) throw new Error('Review destination is missing or ambiguous.');
  const url = new URL(links.attr('href')!, pageUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hostname === new URL(SOURCE).hostname)
    throw new Error('Review has no recognized external destination.');
  return url.href;
}
export function extractListings(html: string, pageUrl: string, listingSelector: string, destinationSelector: string) {
  if (/cf-chl-|Just a moment\.\.\.|captcha/i.test(html.slice(0, 12000))) throw new Error('Source returned a challenge page.');
  const $ = load(html); const listings = $(listingSelector);
  if (!listings.length) throw new Error('No listing elements found. Check the source template and configured selectors.');
  const destinations: string[] = []; const internal: string[] = [];
  listings.each((_, element) => {
    const container = $(element);
    // Verified category cards expose their destination even when their visible
    // heading links to an internal review page. Never derive it from a label.
    const external = container.attr('data-external-link');
    if (external) {
      try {
        const url = new URL(external, pageUrl);
        if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) {
          if (url.hostname === new URL(SOURCE).hostname) internal.push(url.href);
          else destinations.push(url.href);
        }
      } catch { /* invalid structured destination */ }
      return;
    }
    const links = container.is(destinationSelector) ? container : container.find(destinationSelector);
    links.each((_, link) => {
      const value = $(link).attr('data-url') ?? $(link).attr('href');
      if (!value) return;
      try {
        const url = new URL(value, pageUrl);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return;
        if (url.hostname === new URL(SOURCE).hostname) internal.push(url.href);
        else destinations.push(url.href);
      } catch { /* malformed link: never infer a destination from its label */ }
    });
  });
  const pages: string[] = [];
  $('h2 a[href], a.category-top-card-link[href], a.category-bottom[href], a[rel="next"], .pagination a[href]').each((_, link) => {
    try {
      const url = new URL($(link).attr('href')!, pageUrl); url.hash = '';
      if (url.origin === new URL(SOURCE).origin && !/^\/[a-z]{2}(?:\/|$)/.test(url.pathname) && !EXCLUDED_PATHS.has(url.pathname.replace(/\/$/, ''))) pages.push(url.href);
    } catch { /* ignore invalid navigation */ }
  });
  if (!destinations.length && !internal.length) throw new Error('Listing elements contain no recognized destination links.');
  return { destinations: [...new Set(destinations)], internal: [...new Set(internal)], pages: [...new Set(pages)] };
}
export function assemble(evidence: Evidence[], previous: Rule[], excludedDomains: string[], metadata: Pick<Candidate, 'coverage' | 'pages' | 'unresolved' | 'errors'>, wholeSites: string[] = []): Candidate {
  const included: Evidence[] = []; const excluded: Candidate['excluded'] = [];
  for (const item of evidence) {
    try {
      const originalDomain = item.originalDomain ?? item.domain;
      const result = classify(originalDomain, excludedDomains, wholeSites);
      if (result.reason) excluded.push({ domain: result.domain, reason: result.reason });
      else included.push({ ...item, domain: result.domain, ...(result.domain !== originalDomain ? { originalDomain } : {}) });
    } catch { excluded.push({ domain: item.domain, reason: 'Invalid or nonregistrable domain' }); }
  }
  const rules = validateRules(included.map(e => ({ domain: e.domain, includeSubdomains: true })));
  const before = new Set(previous.map(r => r.domain)); const after = new Set(rules.map(r => r.domain));
  return { schemaVersion: 1, generatedAt: new Date().toISOString(), source: SOURCE, ...metadata, rules,
    evidence: included.sort((a, b) => a.domain.localeCompare(b.domain)), excluded,
    diff: { added: [...after].filter(d => !before.has(d)).sort(), removed: [...before].filter(d => !after.has(d)).sort() } };
}
