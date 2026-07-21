# Changelog

What changed in Vantage, written for the people who use it — what you'll notice, not which
pull request landed. The app shows these in **Help → What's new** after an update, so keep
entries short, plain, and about impact.

**Maintaining this file**

- Add to **Unreleased** as you go; `npm run publish:release` computes the version from the
  commits, so the heading is renamed at release time (see [docs/overwolf-submission.md](docs/overwolf-submission.md)).
- User-visible changes only. Refactors, CI and docs don't belong here — the GitHub release's
  auto-generated notes already list every PR.
- Be straight about known gaps; Overwolf's guidance asks for transparency about what's still broken.

Releases before 0.32.0 predate this file. Their notes are auto-generated per PR on the
[Releases page](https://github.com/AyKarambo/vantage/releases).

## Unreleased

### Added

- **Delete a match.** When the game feed invents a game that never happened — a phantom match,
  an `Unknown` map, a custom read as tracked play — you can now remove it instead of living
  with it skewing your winrate, streaks and priority maps. It's on the **⋯ menu** of any row
  in Matches, and on the grading card in Review so a bogus game can be deleted rather than
  graded. Both take two clicks and tell you which match you're about to lose, and the
  confirmation that follows offers **Undo** — which puts the real match back, grades and all,
  not a retyped copy. The undo lasts as long as the message is on screen; once it's gone, or
  once you restart Vantage, the delete is permanent.

- **An FAQ**, reachable from **Help** in the status bar — what live tracking needs, why a match
  you joined late looks incomplete, where your data lives, how Notion sync works, and how to
  report a bug. It also keeps this changelog, so you can read back through it any time.
- **Report a bug from inside the app** (About). It opens a prefilled report with your build
  details filled in, and can save your debug log to a file you choose. The saved log has
  BattleTags and other identifying details stripped — that's best-effort, not a guarantee, so
  give it a look before attaching it to a public issue.
- **What's new after an update** — a short summary of what changed, shown once.

### Fixed

- **Being offline no longer looks like something is broken.** Starting Vantage without a
  connection (with Notion set up) used to pop a Windows notification reading "Maps load failed —
  TypeError: fetch failed", and the Notion screen claimed your database had the wrong shape.
  Neither was true. Vantage now stays quiet about a lost connection and, where it matters, says
  plainly that it can't reach the service.
- **Notion sync explains itself when it fails.** A failed sync reported "0 synced, 12 failed"
  with no reason. It now tells you why.

### Changed

- **The installer asks you to accept the Terms of Use and Privacy Policy**, which are now
  published at a public link you can read before installing.

## 0.32.0 — 15 July 2026

### Added

- **Focus Trend** — a per-target learning curve that shows the dip-then-rebound you get while a
  new habit beds in, with a hit-rate overlay and an in-app guide to reading it honestly.
- **Click a player** anywhere they appear to see every match you've shared with them.
- **Target grades in match views**, calculated from the match's own stats, with a configurable
  margin for what counts as a partial hit.
- **A banner when Overwatch's event feed is down**, and a notification when it recovers, so a
  quiet app is never mistaken for a broken one.

### Changed

- **Review lets you enter the real SR change yourself** — and Vantage no longer invents one when
  it doesn't know.
- **Matches the feed reported incompletely wait in Review** instead of being dropped silently.
- **Focus concentrates on maps**, where the actionable losses actually are.
- **Match detail** reads better: a damage icon, a roomier scoreboard, a per-hero "All" tab, and a
  ±25 SR preset.

### Fixed

- **Aatlis** is recognised instead of showing up as an unknown map.
