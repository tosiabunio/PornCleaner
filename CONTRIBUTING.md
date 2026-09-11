# Contributing

Code contributions use the project's [Unlicense](UNLICENSE).

Use Node.js 22, selected by `.nvmrc`. From a fresh checkout:

```sh
npm ci
npm run check
PLAYWRIGHT_BROWSERS_PATH=.browsers npx playwright install chromium
npm run test:browser
```

On Linux, add `--with-deps` to the Playwright installation command if browser system dependencies are missing. Packaging uses `/usr/bin/zip` and supports macOS and Linux.

## Changes to cleanup

Use the disposable-profile browser tests and synthetic history to verify deletion behavior. Preserve exception precedence, the saved pause setting, and manual preview boundaries. Run `npm run check`; run `npm run test:browser` when changing Chrome integration, UI behavior, or the bundled dataset.

## Changes to domains

Follow the review process in [README.md](README.md#refresh-the-domain-list). Commit the approved dataset, provenance, matching review record, and maintained policy files together. Keep unreviewed candidates, cached source HTML, and local archives out of Git.

A new whole-site scope entry expands deletion to the parent and its subdomains. Explain that scope using source evidence. General platforms and ambiguous tracking destinations should stay excluded until their intended coverage is established.

## Pull requests

Describe the problem, resulting behavior, and validation performed. Keep generated builds and local browser profiles out of the change. For bugs, provide synthetic reproduction steps; public issues should contain no personal browsing history.

The browser-test command packages the end-user download, extracts it into a temporary directory, and tests that exact extension. The offline installation-guide templates live in `distribution/`.

GitHub Actions runs the build and browser checks from the committed dataset. CI uploads the distribution ZIP and synthetic test results without collecting or promoting domain updates. The separate **Prepare release** workflow creates a tested draft release for manual publication.
