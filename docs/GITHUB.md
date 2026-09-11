# Uploading to GitHub

The local repository uses `main`. Source code, the lockfile, approved data, review evidence, and project documentation belong in Git. Dependencies, builds, browser downloads, cached HTML, unreviewed candidates, and local archives are ignored.

## First upload

1. Create an empty GitHub repository, choosing the account and visibility you want. Suggested name: `PornCleaner`. Leave GitHub's README, license, and `.gitignore` initialization options unchecked because this project supplies its own files.
2. From the project folder, replace `YOUR-ACCOUNT` in the URL below and run:

```sh
git remote add origin https://github.com/YOUR-ACCOUNT/PornCleaner.git
git push -u origin main
```

Suggested repository description: “Chrome extension that automatically clears history for reviewed adult domains, with local processing, pause controls, and exceptions.”

Suggested topics: `chrome-extension`, `browser-history`, `privacy`, `typescript`.

## Verification and downloads

The [CI workflow](../.github/workflows/ci.yml) runs on pushes to `main`, pull requests, and manual dispatch. It installs the locked dependencies, runs the typecheck and unit tests, builds the extension, tests it in a disposable browser profile, and packages the ZIP.

After a successful run, open its Actions summary to download the versioned extension ZIP. A separate `browser-test-results` artifact contains the report and synthetic UI captures. Artifacts are retained for 14 days. CI uses the committed dataset and never invokes the scraper.

CI has read-only repository permissions and does not need repository secrets. Monthly Dependabot pull requests cover npm packages and GitHub Actions. GitHub-hosted execution is verified by the first workflow run after upload; local test results are documented in [TESTING.md](../TESTING.md).

## Releases

For a downloadable release, update `package.json`, `package-lock.json`, and `extension/manifest.json` together, run the checks and `npm run package`, and attach the resulting `artifacts/porncleaner-VERSION.zip` to a GitHub release. The ZIP contains the installable extension; GitHub's generated source archives need the documented build step first.

The workflow saves build artifacts without publishing releases or submitting to the Chrome Web Store.

Workflow references: [Playwright CI setup](https://playwright.dev/docs/ci-intro), [GitHub artifact action](https://github.com/actions/upload-artifact/tree/v7.0.1).
