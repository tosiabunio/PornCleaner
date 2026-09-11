# Verification

Verified on macOS, 2026-09-11. Commands: `npm run check` and `npm run test:browser`.

**Unit tests: 19 passed.** They cover hostname boundaries, subdomains, exceptions, internationalized domains, invalid rules, public-suffix rejection, source extraction, review-page fallback, shared-platform exclusions, explicitly reviewed parent-domain coverage, and public-network address validation.

The scanner fixture contains 2,601 distinct URLs, including entries older than 24 hours and 1,600 URLs with identical timestamps. The expected set matches the enumerated set. A separate 32,001-URL tied-timestamp fixture verifies that unresolved result caps produce an incomplete result rather than silent truncation.

Cleanup tests verify default-on installation, removal of all visits to a selected URL, preservation of unrelated history, pause persistence, preview behavior, stale-preview rejection, exceptions, interrupted jobs, retries, cancellation, preview expiration, and failure to load corrupt settings.

**Browser checks: 10 passed** using a downloaded Chrome for Testing build and a newly created disposable profile. The tests load a copy of the production extension and use a separate fixture extension to seed history through Chrome's API. No seeded website is opened.

- Initial installation removes 1,250 matching URLs across capped history queries and preserves every control URL.
- New visits are removed automatically.
- Manual preview performs no deletion, and cleanup respects the selected domains.
- Exceptions survive recovery scans.
- Custom domains work and invalid public-suffix input is rejected.
- Automatic cleaning works after forced service-worker termination.
- Persistent storage and exports contain configuration only.
- A saved pause survives browser restart and extension update.
- Management and popup pages render without script errors or external requests; the narrow layout has no horizontal overflow.

The exact browser version, tested dataset version, and domain count are recorded in `artifacts/browser-test-report.json`. UI captures are `artifacts/manage.png`, `artifacts/manage-preview.png`, `artifacts/manage-mobile.png`, and `artifacts/popup.png`. The test deletes its own temporary profile after completion.

**Source validation:** the homepage, a category page, and an internal review page were retrieved and inspected to establish the parser's selectors. The successful crawl covered 130 pages and produced 2,250 candidates before final scope review. The release contains 2,076 domain rules after exclusions and reviewed parent-domain normalization. The three unresolved URLs are internal category navigation links. The collector reads structured destination attributes and explicit review links, honors the source robots.txt, and records unresolved links rather than guessing. `data/provenance.json` records the approved collection's source pages, original hosts for expanded rules, exclusions, and candidate fingerprint.

**Limits:** no real-account Chrome Sync test was performed; the interface explains its documented propagation behavior. Older-history and extreme timestamp-density cases use controlled unit fixtures. The dataset reflects the selected directory scope and excludes shared platforms and uncertain destinations; it is not an exhaustive list of adult websites.

**GitHub preparation:** a clean export containing only the staged source files passed `npm ci`, the 19 unit tests, the 10 browser checks, and packaging. The browser checks reused the downloaded test browser with a new disposable profile. Workflow and Dependabot YAML were parsed locally. GitHub-hosted CI will run after the first upload; it has not been executed remotely yet.
