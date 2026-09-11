# PornCleaner

A Chrome extension that automatically removes history for a reviewed list of adult domains. The list is collected from The Porn Dude; all history matching and deletion happens locally.

Automatic cleaning starts enabled. Installation cleans existing matching history, then removes matching URLs after new visits are recorded. You can pause it and keep specific domains. A saved pause setting survives restarts and extension updates.

## Install

Build the extension after cloning or downloading this repository. Node.js 22 is selected by `.nvmrc`:

```sh
npm ci
npm run build
```

1. Open `chrome://extensions` in desktop Chrome.
2. Enable **Developer mode** and choose **Load unpacked**.
3. Select this project's `dist` folder.

Pin PornCleaner from Chrome's extensions menu to access its pause control. The management page opens on first installation. Keep the unpacked folder in place; after rebuilding, click **Reload** on the extension card.

If you have a packaged `porncleaner-VERSION.zip`, extract it to a permanent folder and load that folder instead. The ZIP already contains the built extension. The `dist/` directory and ZIP files are generated locally and are excluded from Git.

Installing starts cleanup immediately. Deletions remove all visits to matching URLs, cannot be undone by this extension, and may propagate to other devices through Chrome history sync. Google account search activity is separate.

## Use

- **Pause cleaning / Resume cleaning:** control automatic deletion. Resuming also scans existing history.
- **Your exceptions:** preserve a hostname, optionally including its subdomains. Exceptions override bundled and custom cleanup rules.
- **Your custom domains:** add a hostname to clean. Enter a domain without a scheme, path, wildcard, or port. Adding it while cleaning is on starts a recovery scan.
- **Pause & scan:** pause automatic cleaning and create a manual preview. Select domains to remove; deselecting affects only that cleanup. Use **Keep** to create a permanent exception.
- **Stop cleanup:** cancel pending work. Deletions already in progress cannot be reversed.
- **Import / Export settings:** transfer only the enabled setting, custom domains, and exceptions. Import replaces the current settings; its enabled setting takes effect immediately.

The management page displays the bundled domain count, version, collection date, and coverage. The list is not a universal classifier. Domains absent from the list remain in history unless you add them.

The initial release contains **2,076 domain rules**, collected from 130 English directory pages on 2026-09-11. Shared platforms, payment and tracking services, non-content categories, and destinations with uncertain scope are excluded. The three unresolved links were internal category navigation. This covers the selected main-directory categories, not every adult site or every section of the source.

## Privacy and permissions

The extension requests `history`, `storage`, and `alarms`. It has no host permissions, content scripts, analytics, remote assets, or external network lookups. It reads its bundled JSON using an internal extension URL.

Only configuration is stored persistently. Temporary preview and work queues use memory-backed extension session storage, bounded to 4 MB. Preview information expires after 30 minutes and disappears when the browser restarts or the extension reloads. No visited URLs are included in exports or persistent logs. This extension does not remove cookies, bookmarks, downloaded files, or open tabs.

Automatic cleaning uses visit events, a startup scan, and recovery scans approximately every 15 minutes. Chrome may delay alarms. Visits can briefly appear before deletion; this does not prevent Chrome from initially recording them.

## Build and verify

Requires Node.js 22 or newer and npm. Dependencies are pinned in `package-lock.json`.

```sh
npm ci
npm run check
PLAYWRIGHT_BROWSERS_PATH=.browsers npx playwright install chromium
npm run test:browser
npm run package
```

`npm run check` typechecks, runs unit tests, and builds `dist/`. The browser test loads a copy of the production build into a newly created temporary profile. It seeds synthetic history through a separate helper extension and never visits the seeded websites or opens your regular Chrome profile. Screenshots and a machine-readable report are written to `artifacts/`.

The packaged ZIP is `artifacts/porncleaner-0.1.0.zip`; extract it to a permanent directory before using Load unpacked. Chrome Web Store submission is a separate distribution step.

GitHub Actions runs these checks using the committed dataset and saves the installable ZIP and browser-test artifacts. See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidance and [docs/GITHUB.md](docs/GITHUB.md) for the first upload and release process.

## Refresh the domain list

The collector is a separate developer command. The extension never contacts the source directory.

```sh
npm run scrape -- --inspect
npm run scrape -- --output data/candidate.json
```

The initial source requests encountered a challenge; the implemented collector subsequently retrieved robots.txt and directory HTML successfully. Current selectors were inspected on 2026-09-11:

- Homepage: `li.category-item`, with `a.link-analytics[href]`.
- Category pages: `.thumbs-list-content .review-card[data-external-link]`, reading the explicit destination attribute.
- Internal review fallback: the unique `main a.favicon-bar-domain[href]` destination.
- Category discovery: heading links, category cards, category footer links, and pagination.

The homepage is used for discovery. Non-content categories and shared platforms are excluded in `scripts/collection.ts`; extra domain exclusions are maintained in `data/exclusions.json`. The generator normalizes and deduplicates destinations. `data/whole-site-domains.json` explicitly identifies reviewed dedicated sites whose membership or landing subdomains should cover their parent site. Other subdomains remain scoped; shared-platform exclusions still take precedence. Original observed hosts remain in provenance. Known redirect services are resolved with bounded header-only hops; final destination pages are not fetched. Unknown intermediate domains should be identified during review before promotion.

Collection respects robots.txt, uses one request at a time, delays requests, caches successful responses for 24 hours, limits response sizes, and backs off on rate limiting. The default page cap is 250. Challenge pages, unrecognized templates, and failed or truncated crawls produce an error and do not replace the approved dataset. The candidate records unresolved links and lists additions/removals; inspect both when reviewing coverage.

For a changed template, run `--inspect` and pass `--listing-selector` and `--destination-selector` overrides. An offline extraction is supported with `--snapshot saved-category.html --url https://theporndude.com/the-category`. Snapshot extraction can still resolve known redirect links over the network. `--seed` reconstructs the original limited research sample without network access; it is a recovery input, not an automatic fallback for failed live collection.

After changing exclusions or reviewed whole-site coverage, reprocess an existing candidate without repeating network collection: `npm run scrape -- --reprocess data/candidate-full.json --output data/candidate.json`. This reapplies policy to the saved evidence and retains prior exclusions and errors. It cannot recover destinations that were already excluded from that evidence; a new collection is needed to reconsider those.

Review `data/candidate.json`, particularly new domains, shared platforms, domains serving both general and adult content, unresolved redirects, and unusually large additions/removals. Create a review JSON with the SHA-256 of the exact candidate file and the explicitly accepted domain names:

```json
{
  "candidateSha256": "<SHA-256 of the exact candidate file>",
  "domains": ["reviewed-domain.example"]
}
```

The example domain is a placeholder. A public suffix or invalid hostname will be rejected. Get the fingerprint with `shasum -a 256 data/candidate.json`, then promote the reviewed selection:

```sh
npm run approve:data -- --candidate data/candidate.json --reviewed data/reviewed-domains.json
npm run check
npm run test:browser
npm run package
```

Promotion requires a matching candidate fingerprint, rejects failed/empty collections, archives the previous approved dataset, and atomically replaces `data/domains.json`. Detailed provenance lives in `data/provenance.json`; it is not bundled into the extension. Run collection on demand or from a weekly job, then review and ship an extension release. Do not automatically publish unreviewed candidates.

## Project files

| Path | Purpose |
| --- | --- |
| `src/shared/` | Domain validation, matching, history enumeration, and cleanup coordinator |
| `src/worker.ts` | Chrome API adapter, visit events, job serialization, and alarm recovery |
| `src/ui.ts`, `extension/` | Popup, management interface, styles, and manifest |
| `scripts/` | Source collection, dataset promotion, build, and packaging |
| `data/domains.json` | Approved runtime list |
| `data/provenance.json` | Source evidence and review fingerprint |
| `data/exclusions.json`, `data/whole-site-domains.json` | Maintained exclusion and whole-site scope decisions |
| `tests/` | Boundary tests and isolated browser verification |

History enumeration subdivides capped time windows, overlaps boundaries, and handles timestamp ties. Incomplete enumeration is surfaced explicitly. Manual deletion uses only the reviewed snapshot; changing rules invalidates it. Automatic work rechecks current rules and exceptions, and transient work is checkpointed between worker activations.

Chrome Sync was not exercised with real accounts in the automated tests. The interface explains its documented propagation behavior without claiming that deletion is limited to a single device.

## License

The project's source uses the [Unlicense](UNLICENSE), as published at [unlicense.org](https://unlicense.org/). Third-party dependencies retain their own licenses. Both the project license and the bundled dependency's license notice are included in the extension ZIP.
