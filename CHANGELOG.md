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

- **The sidebar collapses to an icon rail** — the `«` control under the session card, or
  **Ctrl B**. It sticks between launches. Each icon keeps its name as a tooltip, and the Review
  count becomes a dot. Handy on a small screen, or whenever you'd rather have the room.

- **Every match remembers the rank you went into it with.** Your history now shows where you
  stood when each game started, so you can read a session back and see the climb (or the slide)
  match by match rather than only today's number. It appears on the match detail page, and as a
  **Rank at start** field you can turn on in **Matches → Customize view**.
  It's a snapshot, taken when you record that match's ±% — so correcting an older game later
  never rewrites what a newer one says you had at the time. Matches with no ±% recorded show
  nothing: without one your rank didn't move there, and repeating the previous match's number
  would look like evidence Vantage doesn't actually have.
- **A Live screen** for the match you're in right now. It shows the scoreboard the game is
  showing — heroes, eliminations, assists, deaths, damage, healing and mitigation, split into
  your team and theirs — updated as the match plays. A dot on the nav item tells you a match
  is running; the screen empties again the moment it ends, or if Overwatch closes.
- **"Players you've met", live.** Everyone on the current roster you've shared a game with
  before, with your record **with** them when they're on your team this match and **vs** them
  when they're against you. Click a name for the full history, same as anywhere else.
- **Damage and healing totals per team on the Live screen**, next to the elimination count, so
  you can see at a glance which side is out-damaging or out-healing the other. The side that's
  ahead on each line is the brighter one. These come from the game's own scoreboard rather than
  the kill feed, so they stay even with the kill feed switched off. The live scoreboard is also
  ordered like the game's: your team first, then tank, both DPS, both supports.
- **A live elimination count**, from the kill feed. Be aware of what this is and isn't:
  Overwatch's event feed reports **no objective score**, so Vantage counts eliminations and
  labels them as such rather than inventing a scoreline. If a running kill count while you're
  still in the game isn't for you, switch it off in **Settings → General** — that stops it
  being sent to the window at all, and leaves the scoreboard and with/vs records untouched.

### Fixed

- **The whole navigation fits again.** **Data** and **App** are now one **App** group (Notion
  sync, Logs, Settings, About and FAQ together — the split was never something you navigated
  by), and the rows are a little tighter, so every screen is reachable without scrolling at the
  default window size.
- **The "Current session" card no longer sits on top of the status bar.** With every screen the
  sidebar now lists, the navigation was taller than the space it had — so the card at the bottom
  was pushed straight out of the sidebar and over the status bar underneath it. The navigation
  scrolls when it doesn't fit; the account switcher above it and the session card below it stay
  where they are.
- **Readiness no longer nudges you to play more while you're in placements.** Every other screen
  ignores the SR change recorded against a placement match — the game shows no rank at all until
  the run finishes — but Readiness was still reading those numbers, and a flat-looking run could
  therefore be counted as "proven rank stagnation" and fire the play-more nudge, with a small
  score dip behind it. Placement matches now count as no evidence either way, which is what the
  rest of the app has always said about them.

- **New accounts are offered a placement run.** Vantage only ever offered one at a season reset,
  and only for a role it already knew your rank for — so a fresh account, or a role you'd never
  queued, was never asked. You had to know to press **Start placements** before your first ranked
  game, and every game you played before that was quietly left out of the run. It now asks after
  the first ranked match on any track it has no rank for, live-tracked games included (previously
  only hand-logged ones could raise the question at all).
- **Accepting a placement offer counts the games you already played.** The run used to start at
  the moment you answered, so the very match that prompted it fell outside its own run — you'd
  answer after your fourth placement and the dashboard would say 3/10. The prompt now says how
  many matches it will count before you accept.
- **Placements are reachable for a role with no rank.** Settings → Accounts only showed a row for
  roles it already tracked, and the Start buttons live on that row — so a role you'd never
  queued had no way in. There's now a **Start placements…** entry for those, and an open run's
  start can be **moved to a different match** if it was begun too late.
- **A ±% is no longer shown for matches inside an open run.** Overwatch shows no rank change
  during placements, and Vantage already ignored the stored value everywhere rank appears — but
  the Matches list still displayed it. The value is only hidden, not erased: cancel the run and
  it's back.
- **Renaming an account keeps its placement runs.** They used to be left behind under the old
  name, along with any declines.
- **Your rank updates the moment you record it.** Entering a skill-rating change — or setting
  your current rank — while grading a match on **Review** left the rank in the top-left corner
  showing the old number until something unrelated happened to reload it (changing a filter,
  alt-tabbing back in, or playing another game). It now updates immediately, along with
  everything else derived from it. Confirming your rank at the end of a placement run does the
  same, instead of leaving the corner stuck on "Placements 10/10".

### Changed

- **Targets list and detail page.** The Targets list now shows each target in plain language —
  name, grading mode, hit-rate, and a one-sentence status (e.g., "Paying off — you win more when
  you hit it") — alongside an **Active** toggle, removing stats jargon from the overview. Click
  any row to open a dedicated **detail page** with the full breakdown: the rule, win-when-hit and
  win-when-missed rates, the **Focus Trend** panel (before/after winrate with a rolling chart
  and table toggle), and actions to **Edit** (pre-filling the builder), **Archive**, or
  **Delete**. Edit returns to the Targets list with the builder pre-filled.
- **Target library.** The builder's flat "Start from a template" chips are now a curated
  **Target library** card featuring ~18 entries grouped under **Mechanics · Macro · Strategy ·
  Training** — a decision-timing split — each with a visible coaching blurb and role tag. Pick
  one to prefill the builder.

## 0.34.0 — 31 July 2026

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
