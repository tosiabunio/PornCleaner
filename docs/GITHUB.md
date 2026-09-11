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

After a successful run, open its Actions summary to download `porncleaner-chrome.zip`. A separate `browser-test-results` artifact contains the report and synthetic UI captures. Artifacts are retained for 14 days. CI uses the committed dataset and never invokes the scraper. End users should get the ZIP from a published release so their download link remains available.

CI has read-only repository permissions and does not need repository secrets. Monthly Dependabot pull requests cover npm packages and GitHub Actions. GitHub-hosted execution is verified by the first workflow run after upload; local test results are documented in [TESTING.md](../TESTING.md).

## Offer a download to end users

Once the project is on GitHub:

1. Open **Actions → Prepare release → Run workflow**, selecting the branch you want to release.
2. The workflow builds the ZIP, tests the extension extracted from that ZIP, and creates a **draft release** with the download and installation instructions attached.
3. Open **Releases**, review the draft, and click **Publish release**. Share that release page with end users.

For subsequent releases, update `package.json`, `package-lock.json`, and `extension/manifest.json` to the same new version before running the workflow. The workflow stops if that version tag already exists and never overwrites an existing release. The draft targets the exact commit tested by the workflow.

The download asset is always named **porncleaner-chrome.zip**, so after publishing a latest release you can share this stable URL (replace `YOUR-ACCOUNT`):

```text
https://github.com/YOUR-ACCOUNT/PornCleaner/releases/latest/download/porncleaner-chrome.zip
```

Use a public repository if you want people to download it without repository access. The standard GitHub source-code archives are for developers; the release description directs end users to the prepared ZIP.

## Build a download locally

Run `npm run package` to generate:

| Output | Purpose |
| --- | --- |
| `artifacts/porncleaner-chrome.zip` | The end-user download: built extension, offline HTML guide, and plain-text instructions |
| `artifacts/porncleaner-VERSION.zip` | An identical versioned copy for your local archive |
| `artifacts/PornCleaner/` | The extracted bundle for inspection |
| `artifacts/release-notes.md` | Installation text to paste into a release or download page |

`npm run test:browser` builds the ZIP and verifies the extension loaded from its `PornCleaner/Chrome` folder. It also checks that the packaged installation guide renders offline.

You can also create a GitHub release manually, attach `porncleaner-chrome.zip`, and copy the generated release notes. The automated workflow prepares a draft; publishing remains the final step.

## Chrome installation method

This ZIP is ready to use through Chrome's **Developer mode → Load unpacked** flow. The bundled guide explains installation, pausing, updates, and removal. For the conventional **Add to Chrome** experience and automatic updates, the next distribution step is Chrome Web Store submission. See [Chrome's distribution guidance](https://developer.chrome.com/docs/extensions/how-to/distribute).

Workflow references: [Playwright CI setup](https://playwright.dev/docs/ci-intro), [GitHub artifact action](https://github.com/actions/upload-artifact/tree/v7.0.1), [draft releases with GitHub CLI](https://cli.github.com/manual/gh_release_create).
