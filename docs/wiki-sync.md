# Wiki sync

The GitHub wiki (`AyKarambo/vantage.wiki`) is a **mirror**, not a second source of truth.
**`docs/` in this repo is canonical.** When onboarding docs change, refresh the wiki from
them with `scripts/sync-wiki.mjs`; never hand-edit a wiki page directly, or the next sync
will silently overwrite it.

## Key pages mirrored

`scripts/sync-wiki.mjs` copies a fixed set of "key pages" — the docs useful to someone
browsing the project on GitHub without cloning it — into wiki-page filenames:

| Source (`docs/…`) | Wiki page |
|---|---|
| `onboarding/README.md` | `Home.md` |
| `onboarding/01-getting-started.md` | `Getting-Started.md` |
| `onboarding/02-architecture.md` | `Architecture.md` |
| `onboarding/03-codebase-tour.md` | `Codebase-Tour.md` |
| `onboarding/04-common-tasks.md` | `Common-Tasks.md` |
| `import.md` | `Importing-Match-History.md` |
| `signing.md` | `Release-Signing.md` |

**Deliberately excluded:**

- `overwolf-submission.md` and `overwolf-review/` — the Overwolf store-submission runbook
  and its QA screenshots. Maintainer-only material with real submission-flow specifics; not
  meant for a public wiki, and explicitly out of scope for this sync tool.
- `legal/privacy.html` / `legal/terms.html` — published separately as the app's own legal
  URLs (see the main README's *Support* section), not wiki content.
- `wiki-sync.md` (this file) — describes the sync process itself; not useful as a wiki page.

Each mirrored page gets a one-line HTML-comment header pointing back at its source file in
the main repo, so anyone landing on the wiki page knows where to make the real edit.

## Running a sync

The sync only ever **writes into a local clone of the wiki** that you point it at — it
never touches this repo's `docs/`, and it never runs `git` or talks to the network itself:

```bash
# once, if you don't already have the wiki cloned somewhere:
git clone https://github.com/AyKarambo/vantage.wiki.git ../vantage.wiki

# preview what would change, no files written:
node scripts/sync-wiki.mjs ../vantage.wiki --dry-run

# actually write the mirrored pages:
node scripts/sync-wiki.mjs ../vantage.wiki
```

## Publishing (manual, maintainer-only)

Pushing the result to GitHub needs the maintainer's own credentials against the
`AyKarambo/vantage.wiki` repo, so it is **not** automated by this script or by any CI job:

```bash
cd ../vantage.wiki
git add -A
git diff --cached          # review before committing
git commit -m "sync from docs/"
git push
```

Run a sync (and this manual publish step) whenever a change lands in one of the key pages
above — most often alongside the onboarding-docs updates described in
[docs/onboarding/](onboarding/README.md).
