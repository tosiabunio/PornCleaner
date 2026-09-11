# PornCleaner implementation plan

Planning date: 2026-09-11. Status: implemented for local Chrome installation. See [README.md](README.md) for setup and [TESTING.md](TESTING.md) for verification evidence.

Build one Chrome extension that removes history entries whose hostnames match a curated domain list generated from The Porn Dude. Generate the list with a separate scraper; bundle the approved output with the extension so browsing history can be processed entirely on the device.

Confirmed preference: automatic cleaning is enabled by default. On first installation, clean existing matching history and continue removing matching URLs as visits are recorded. Provide a persistent on/off control, domain exceptions, and an optional manual scan with a preview.

Other planning assumptions: desktop Chrome and personal installation through Load unpacked first. Chrome Web Store distribution and remote list updates are later work.

**1. User experience**

- The toolbar popup prominently shows Automatic cleaning: On, a control to turn it off, domain-list version/date, and buttons to scan history and manage domains. Initial setup explains that cleanup includes existing matching history and starts automatically.
- An optional manual scan opens an extension page with progress, followed by matched domains and the number of distinct URLs per domain. Users can deselect domains and add permanent exceptions before choosing Delete selected history. Deselecting an item in a manual preview does not create an automatic-cleaning exception; offer an explicit Keep this domain action for that purpose.
- Setup and manual deletion controls clearly state that cleanup removes all visits to matching URLs and cannot be undone by this extension. Report successful, failed, and remaining items separately; cancellation stops pending work.
- Settings allow custom domains, exceptions, configuration import/export, and a Keep matching domains out of history toggle that starts on. Exceptions always take precedence. Preserve the user's on/off choice across restarts and extension updates.
- Show domains and counts by default. URL details are available only when requested. Render all source/history strings as text.
- Display an incomplete-scan state when enumeration cannot finish; never present a partial result as a complete cleanup.

Chrome's per-URL deletion removes every occurrence of that URL, while range deletion has no domain filter. Therefore the first version has no date-limited deletion selector. Counts refer to distinct URLs, not individual visits. [History API](https://developer.chrome.com/docs/extensions/reference/api/history)

**2. Domain-list generation**

Use a separate Node.js/TypeScript command with an HTML parser, sharing hostname-normalization code with the extension. Prefer HTTP retrieval of directory HTML; evaluate browser rendering only if a small source-access prototype demonstrates that it is necessary.

The inspected directory has category links, direct destinations, redirect links, and listings referring to pages on shared platforms. This means extracting every outbound hostname would produce an unsuitable deletion list. [The Porn Dude directory](https://theporndude.com/)

Implemented pipeline:

1. Establish permitted crawl scope and confirm access to robots.txt before the first full crawl. The implemented collector successfully retrieved the source's rules after the planning tool could not access them. Recheck the site's current terms when implementing scheduled collection. [Source terms](https://theporndude.com/tos)
2. Discover English category/listing pages and pagination. Keep the crawl on explicitly configured directory hosts; use canonical URLs and a visited set to avoid translation and navigation loops.
3. Extract destinations only from identified listing elements. Inspect internal review pages when their structured destination is needed. Do not copy review prose or media into the distributed dataset.
4. Prefer explicit destination metadata. For unresolved redirect links, inspect a limited redirect chain, validate each destination, reject private/local addresses, and stop before fetching destination content once its hostname is established. Quarantine unresolved or ambiguous results instead of guessing from a display name.
5. Normalize hostnames, deduplicate, and classify candidates. Exclude social platforms, general file hosts, analytics, advertising infrastructure, and shared redirect services from default whole-domain rules. Add the source directory itself as an explicit reviewed rule.
6. Produce a sorted candidate list plus provenance: source page, extraction method, category, and collection timestamp. Emit coverage counts, unresolved links, and additions/removals relative to the previous version.
7. Review changes before promoting them to the bundled list. Retain the previous version if collection fails, a page template is unrecognized, or the new output unexpectedly collapses or expands. Support exclusions and corrections as maintained inputs to the generator.

Start with one request at a time, a delay between requests, caching, timeouts, bounded retries, and backoff for rate-limit responses. Treat authentication, challenge pages, and unexpected content as collection failures. The initial prototype must establish actual coverage; no total-domain count is promised from the homepage alone.

Runtime dataset shape: schema version, dataset version, generated timestamp, source identifier, and rules containing a normalized domain plus an explicit includeSubdomains flag. Keep detailed provenance in the build outputs. Refresh manually for the first release; later schedule candidate generation weekly and ship reviewed changes through extension releases.

**3. Domain matching**

Use URL parsing and compare the hostname, considering HTTP and HTTPS entries. Matching is exact, or a dot-delimited subdomain match when enabled:

```text
hostname == rule.domain
OR (rule.includeSubdomains AND hostname ends with "." + rule.domain)
```

Normalize case, terminal dots, and internationalized hostname representation consistently. An approved whole-site rule can cover www and other subdomains. Preserve explicitly scoped subdomains; never automatically broaden a tenant hostname to its shared hosting domain. Reject public suffixes and malformed custom rules using a maintained public-suffix parser.

Implementation: explicit whole-site scope decisions are maintained in `data/whole-site-domains.json`. They cover reviewed dedicated sites reached through membership or landing subdomains, while preserving original observed hosts in provenance. Other subdomains remain scoped.

For a synthetic rule `adult.example.com`, match `adult.example.com` and `www.adult.example.com`; preserve `notadult.example.com`, `adult.example.com.evil.net`, and `search.example.com/?q=adult.example.com`. Do not infer matches from titles, path text, or search-query strings.

Exclude shared platforms such as Reddit from the generated default whole-domain list. Path-specific rules can be a later, separately designed feature. A user can explicitly add a whole shared domain, with its full scope visible in settings.

**4. Extension architecture and permissions**

Use Manifest V3, TypeScript, a small build step, and plain HTML/CSS for the popup and full extension page. A UI framework is unnecessary for this scope. Bundle all executable code and the domain dataset.

| Component | Responsibility |
| --- | --- |
| Domain matcher | Validate and normalize rules; apply exceptions and hostname matching |
| History scanner | Enumerate available history in bounded batches and produce a preview |
| Cleanup coordinator | Execute the reviewed URL set, track progress, cancel, and retry failures |
| Service worker | Handle automatic cleaning, initialization, and recovery events |
| Popup and extension page | Status, preview, deletion controls, and domain settings |
| Local configuration | Custom rules, exceptions, preferences, and dataset metadata |

Request `history` for reading/deleting history, `storage` for settings and transient job state, and `alarms` for automatic reconciliation and background-job continuation. The bundled-list design requires no website host permissions, content scripts, or access to page contents. Keep external networking out of the extension's first release.

Store preferences locally. Keep temporary matched URLs in memory or bounded `storage.session` state, clear them after a job, and exclude them from logs and exports. Session storage survives worker shutdown but is cleared on browser restart and extension reload/update. Handle its quota explicitly. [Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage)

**5. History enumeration and deletion**

- Start history queries explicitly at epoch zero and specify a result limit; the API defaults cover only 24 hours and 100 results. Use bounded time windows, subdivide saturated windows, overlap boundaries, and deduplicate URLs. Detect timestamp ties and cases that remain capped at the smallest interval; increase the bounded limit or report incomplete coverage rather than skipping entries. [History API](https://developer.chrome.com/docs/extensions/reference/api/history)
- Freeze the dataset version and reviewed URL set for a manual job. If rules change before confirmation, regenerate the preview. Immediately before deletion, honor current exceptions and removed rules; never expand the job to newly matching URLs without another preview.
- For manual jobs, delete only matching URLs from the reviewed set. For automatic jobs, scan using a snapshot of the active rules and recheck the current enabled flag, exceptions, and rule membership before each deletion. Process small batches, capture each API failure, make retry operations idempotent, and serialize competing jobs to prevent duplicate processing and misleading counters.
- Preserve minimal job state between worker activations. After a browser restart, expire any manual job whose reviewed URL set was held in session storage and offer a fresh scan. Never silently broaden a resumed manual deletion.
- Finish with verification of targeted items; explain if subsequent browsing or sync introduced new matches outside the reviewed set.

Design the background jobs for suspension: Chrome may terminate idle service workers, so a long-running promise and global variables are insufficient as the only record of progress. [Service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)

**6. Automatic cleaning by default**

Initialize automatic cleaning to enabled on first installation and begin an all-time scan as soon as the bundled rules and settings are ready. No separate opt-in action is required. Apply defaults only to missing settings; never overwrite a saved disabled preference during initialization, migration, restart, or update. If configuration or dataset loading fails, defer deletion and display the error rather than using unchecked defaults.

Register the history-visit listener at worker initialization and await configuration loading inside its handler. When enabled, reuse the same matcher and deletion coordinator for matching URLs. The listener removes a URL after Chrome records a visit; it cannot guarantee the visit never briefly appears. Revisiting a URL can also remove older occurrences of that same URL. [History API](https://developer.chrome.com/docs/extensions/reference/api/history)

Define the toggle as keeping matching domains out of available history while enabled, including initial cleanup and periodic reconciliation of older entries. Explain that scope in initial setup and beside the toggle. Run a recovery scan at browser startup, when re-enabled, and approximately every 15 minutes while enabled. Check that the alarm exists on worker startup and restore it as needed; scheduled delivery may be delayed. [Alarms API](https://developer.chrome.com/docs/extensions/reference/api/alarms)

Recheck the enabled flag and exceptions before every deletion batch. Turning the toggle off stops automatic deletions that have not yet started and cancels queued automatic scans. Repeated deletion failures produce an actionable status rather than a successful-cleanup indicator. Updated datasets participate in automatic cleaning only after they have passed the dataset review process.

**7. Privacy scope**

All classification and cleanup runs locally; the standalone scraper receives no browser history. Store no persistent record of deleted URLs, use no telemetry, and export only user configuration.

The extension handles Chrome history. Cookies, downloaded files, bookmarks, open tabs, and external activity logs are outside this feature's scope. Chrome history deletion can propagate to devices with history sync enabled; Google account search history is managed separately. Explain this in the cleanup interface and test sync behavior separately before claiming any device-specific guarantees. [Chrome history help](https://support.google.com/chrome/answer/95589?co=GENIE.Platform%3DDesktop&hl=en)

**8. Delivery sequence**

| Phase | Deliverable | Acceptance condition |
| --- | --- | --- |
| 1. Source prototype | Representative extraction, normalization, provenance, and coverage report | Correctly handles direct links, redirects, and ambiguous/shared-platform entries; confirms crawl scope |
| 2. Reviewed dataset | Repeatable generator and bundled versioned JSON | Deterministic output, reviewed initial rules, and failures preserve the prior dataset |
| 3. Automatic extension | Default-on initial cleanup, visit handling, recovery scans, on/off control, and exceptions | Fresh installation cleans existing matches and subsequent visits; preserves unrelated history and saved disabled preferences |
| 4. Management interface | Optional manual scan, preview, custom domains, progress, and cancellation | Removes only selected matching URLs in manual jobs; clearly distinguishes preview selections from persistent exceptions |
| 5. Packaging | Load-unpacked build, installation guide, privacy explanation, and test report | Installs cleanly and works offline with the bundled list |

Project layout: `extension/` for manifest and UI, `src/shared/` for normalization/matching, `scripts/` for dataset generation, `data/` for approved rules and provenance, and `tests/` for fixtures and verification.

**9. Verification**

Test meaningful deletion boundaries before using real personal history. Use a disposable Chrome profile seeded with synthetic HTTP(S) URLs through the history API; adult-site browsing is unnecessary for these checks.

- Matching: exact and subdomain rules, lookalike hosts, query-string mentions, shared hosts, internationalized names, malformed input, and exception precedence.
- Collection: representative sanitized HTML fixtures, redirect loops, missing selectors, incomplete pagination, duplicate listings, and empty/partial output rejection.
- Scanning: more than 100 URLs, entries older than 24 hours, timestamp ties, repeated visits to the same URL, and a large synthetic dataset. Compare enumeration to the seeded expected set.
- Cleanup: preview performs no deletion; selected URLs disappear; nonmatches and exceptions remain; failures, cancellation, and changing rules behave correctly.
- Defaults and lifecycle: first installation enables cleaning and removes existing matches; new visits are cleaned; saved disabled preferences survive restart, reload, and update. Exercise worker termination during a job, disabling during initial cleanup, re-enabling, configuration-load failures, and delayed or missing alarms.
- Privacy: verify extension network silence, configuration-only exports, absence of persistent visited-URL logs, and transient job cleanup.

Completion means an installable build, a reproducible reviewed domain list, and passing evidence for these behaviors. Chrome Web Store publication and remotely downloaded rule updates remain separate milestones.
