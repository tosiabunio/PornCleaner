# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## What this is

A Manifest V3 Chrome extension that deletes browser history for a reviewed list of adult domains, entirely locally. The repo also contains the developer-only pipeline that collects and promotes that domain list. The extension itself never touches the network.

## Commands

Node 22 (`.nvmrc`). Dependencies are pinned; use `npm ci`.

```sh
npm run check          # typecheck + unit tests + build dist/  (the CI gate)
npm run typecheck      # tsc --noEmit over src, scripts, tests
npm test               # node:test via tsx over tests/*.test.ts
npm run build          # esbuild -> dist/ (loadable via chrome://extensions "Load unpacked")
npm run package        # build + artifacts/porncleaner-chrome.zip (+ versioned copy, release-notes.md)
npm run test:browser   # package, then Playwright test of the extracted ZIP in a throwaway profile
```

Run a single unit test by name:

```sh
npx tsx --test --test-name-pattern="hostname boundaries" tests/core.test.ts
```

Browser tests need Chromium downloaded first:

```sh
PLAYWRIGHT_BROWSERS_PATH=.browsers npx playwright install chromium   # add --with-deps on Linux
```

**Platform caveat:** `scripts/package.ts` shells out to `/usr/bin/zip` and `tests/browser.ts` to `/usr/bin/unzip`. These exist on macOS/Linux/CI but `zip` is not present in Git Bash on this Windows machine, so `npm run package` and `npm run test:browser` fail locally here. `npm run check` works everywhere. CI (`.github/workflows/ci.yml`) runs the full sequence on Ubuntu and uploads the ZIP.

Data pipeline (developer only, never run by CI):

```sh
npm run scrape -- --inspect                                   # dump source structure, no candidate written
npm run scrape -- --output data/candidate.json                # live collection (respects robots.txt, cached 24h in .cache/source)
npm run scrape -- --reprocess data/candidate-full.json --output data/candidate.json   # reapply policy offline
npm run approve:data -- --candidate data/candidate.json --reviewed data/reviewed-domains.json
```

## Architecture

### Extension runtime: Port / Engine split

- `src/shared/engine.ts` — `Engine` is the whole cleanup state machine and has **no Chrome dependency**. It talks to the browser only through the `Port` interface in `src/shared/model.ts` (load/save settings, load/save session, history search, deleteUrl, remains, now). Unit tests drive it with a `FakePort`.
- `src/worker.ts` — the MV3 service worker. It implements `Port` over `chrome.storage.local` (settings), `chrome.storage.session` (transient session), and `chrome.history`. Everything else here is plumbing: a `serial()` promise queue so engine calls never interleave, a `pump()` loop that runs `engine.step()` for up to 8 s per activation, alarm scheduling, and the `runtime.onMessage` dispatcher that the UI calls.
- `src/ui.ts` — one bundle shared by `extension/popup.html` and `extension/manage.html`. It renders by element id and tolerates missing ids, so the popup and management page differ only in their HTML.

### Persistent vs. session state

- **Settings** (`chrome.storage.local`): `{ schemaVersion, enabled, customRules, exceptions }`. This is the only thing persisted and the only thing exported/imported. Any settings change goes through `Engine.updateSettings`, which validates, rebuilds the matcher, and **resets the session** (a new auto job is started if enabled).
- **Session** (`chrome.storage.session`, in-memory, 4 MB budget enforced in `Engine.persist`): a bounded `visits` fast-path queue plus at most one `Job`. Exceeding the budget marks the job `incomplete` and drops its data rather than silently truncating. A job whose `datasetVersion` differs from the bundled dataset is discarded on init.

### Jobs

`Job.kind` is `auto` (automatic full scan + delete), `preview` (scan only, "Pause & scan"; starting one forces `enabled=false`), or `delete` (a preview converted by `deleteSelected`). States: `running → ready` (preview) / `complete` / `cancelled` / `incomplete`. Previews expire 30 min after `startedAt`. `Engine.step()` processes, in priority order: one queued visit, then up to 10 pending deletions, then one scanner window, then finalization. Deleting re-checks the matcher and the enabled flag at delete time, so rule edits mid-job are honored.

### Alarms (worker.ts `syncAlarms`)

- `continue` — 30 s recovery, created before each pump so a killed worker resumes.
- `reconcile` — every 15 min while enabled; starts a fresh auto job if none is running.
- `expire-preview` — fires at `startedAt + 30 min` for preview/delete jobs.

Badge shows `OFF` when paused and `!` on a fatal storage/dataset error. A fatal state only clears via an `import` message, which re-initializes.

### Matching (`src/shared/domains.ts`)

`createMatcher(rules, exceptions)` walks hostname suffixes against two maps. **Exceptions win over both bundled and custom rules.** `normalizeDomain` uses `tldts` to reject IPs and bare public suffixes and returns punycode; every rule list is validated and deduplicated via `validateRules` (with `includeSubdomains` OR-merged across duplicates).

### Scanner (`src/shared/scanner.ts`)

Chrome's `history.search` caps results, so `scanStep` treats a full page as a signal to bisect the time window (down to a 4 ms span, then double `maxResults` up to 32,000) **before consuming any entries**. It throws rather than skip history when limits are exhausted; the engine turns that into an `incomplete` job.

### Build and packaging

- `scripts/build.ts` validates `data/domains.json`, copies `extension/` + `UNLICENSE`, bundles `src/worker.ts` and `src/ui.ts` with esbuild (ESM, chrome120 target, minified), and swaps a fresh build into `dist/` atomically. Only `dist/domains.json` is bundled; `data/provenance.json` is not.
- `scripts/package.ts` requires **the version in `extension/manifest.json`, `package.json`, and both places in `package-lock.json` to match**, renders `{{VERSION}}`/`{{MIN_CHROME}}`/`{{DOMAIN_COUNT}}` into the `distribution/` guide templates, and produces `artifacts/porncleaner-chrome.zip` containing `PornCleaner/Chrome` (the loadable folder) plus guides. When bumping the version, update all three files.
- `.github/workflows/release.yml` is manual-dispatch; it re-runs everything and creates a **draft** GitHub release tagged `v<package.json version>`, refusing if the tag exists.

### Domain list pipeline (`scripts/`)

`scrape.ts` crawls the source directory (homepage for discovery only, category pages for destinations, internal review pages as fallback, bounded header-only redirect resolution for `REDIRECTORS`) through `network.ts` (HTTPS only, public-IPv4-only DNS check, 4 MB cap, 1.2 s delay, 24 h disk cache). Policy lives in `collection.ts`: `SHARED` platforms and `EXCLUDED_PATHS` categories are hard-coded there; extra exclusions are in `data/exclusions.json`; `data/whole-site-domains.json` lists the only domains allowed to widen a subdomain to its parent. `assemble()` applies policy and diffs against the current `data/domains.json`. Any challenge page, unrecognized template, or error fails closed: the candidate is written with `errors` and `approve-data.ts` refuses it.

`approve-data.ts` requires a review file whose `candidateSha256` matches the exact candidate bytes and whose `domains` are an explicit subset of the candidate's rules, then archives the old dataset to `data/archive/` (gitignored), atomically replaces `data/domains.json`, and rewrites `data/provenance.json`. Dataset `version` is `<YYYY-MM-DD>-<8-char rule digest>`. Commit `domains.json`, `provenance.json`, `reviewed-domains.json`, and the policy files together; `data/candidate*.json` is gitignored and must never be committed.

### Tests

- `tests/core.test.ts` — matcher, validation, scanner, and full `Engine` behavior through `FakePort` (including tied-timestamp fixtures and a 32,001-URL cap case).
- `tests/collection.test.ts` — extraction, classification, and network address guards, using inline HTML fixtures.
- `tests/browser.ts` — not a `node:test` file. It extracts the packaged ZIP, launches headless Chromium with a persistent temp profile, seeds history through a second throwaway "seeder" extension (no real site is ever visited), and asserts on the extension's `status` messages and pages. Writes `artifacts/browser-test-report.json` and PNG captures. Run it when changing Chrome integration, UI, or the dataset.

## Conventions

- Dense style: multiple short statements per line, 2-space indent, LF endings (`.editorconfig`, `.gitattributes`). Match the surrounding density rather than reformatting.
- User-facing strings in the engine are error/`message` text shown directly in the UI; keep them plain sentences.
- Preserve the documented invariants when touching cleanup: exceptions override everything, the saved pause setting survives restarts and updates, manual deletion only acts on the reviewed preview snapshot, and incomplete enumeration must surface as `incomplete` rather than silently succeed.
- Never add host permissions, content scripts, or remote fetches to the extension; the manifest CSP is `default-src 'self'` and the browser test fails on any external request.
