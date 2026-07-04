# Screen spec: Matches (`matches`)

**Source:** `renderer/src/views/matches.ts`, `renderer/src/views/matchDetail.ts`, `renderer/src/components/scoreboard.ts`, `src/core/matchDetail.ts`, `src/core/playerIndex.ts`, `src/core/analytics/session.ts` (`groupByDay`), `src/main/screenshots.ts` · reverse-engineered 2026-07-04 · detail-page design from user screenshot (2026-07-04 spec review) · updated 2026-07-04 after gap implementation · updated 2026-07-04 after the ui-qol batch (PR #8)
**Provenance tags:** [explicit] stated in code/comments · [inferred] reconstructed from behavior · [confirmed] user decision (2026-07-04 spec review) · [implemented 2026-07-04] shipped in the gap-closing pass · [qol 2026-07-04] shipped in the ui-qol batch (intent: `ui-qol.spec.md`)

**Shared context:** Renders from a `DashboardData` snapshot via `ViewContext`; the global filter bar re-scopes the list. The match detail page is a parameterized view (`matchDetail`, opened with `{ matchId }`) registered in the view router but outside the sidebar nav list — the sidebar keeps **Matches** highlighted while a detail page is open. Shell-level behaviors that touch this screen — the palette's Match/Map/Hero entries, per-route scroll memory (Matches ↔ matchDetail), and the Esc/←/→ hotkeys — are specified in `screen-shell.spec.md`.

## Intent (WHAT & WHY)

[confirmed] The match history log **with click-through to a full match detail page**. [implemented 2026-07-04] Each row now opens a dedicated detail view built to degrade gracefully across the app's different data-capture tiers (live full-roster GEP captures, partial/local-only captures, and older legacy records) — a minimal record still renders a complete header even when richer sections have nothing to show.

## In-Scope

**List:**
- Newest-first list of matches in the filtered range: result letter (W/L/D, colour-coded), map, role · heroes (or "—") · account, map-type pill, game type, relative time.
- Match count in the header (`"N games in range · newest first · click a match for details"`).
- [implemented 2026-07-04] Every row is clickable (`.match-row.is-clickable`) and navigates to `matchDetail` with that row's `matchId`.
- [qol 2026-07-04] **Day grouping:** rows sit under day headers — "Today" / "Yesterday" for the two most recent calendar days, otherwise a friendly date ("Wed, Jul 2") — each header showing that day's `W–L` tally and signed net. Backed by the pure `groupByDay` helper (`src/core/analytics/session.ts`), newest day first, rows newest-first within a day.
- [qol 2026-07-04] **Cross-links inside a row** (clicks `stopPropagation` so the row's detail click stays intact): the map name links to the Maps view with `{ highlight: map }` (scrolled to and flashed there); each hero name links to that hero's drill-down drawer (`openHeroDrawer`).
- [qol 2026-07-04] **Actionable empty state:** an empty range shows "No matches in this range yet." plus next steps instead of a dead end — a "Show all time (N games)" button when unfiltered history has games and the range isn't already all-time (`DashboardData.totalGamesAllTime`), and a "Log a match" button opening the quick-log modal.

**Match detail page** ([implemented 2026-07-04] `renderer/src/views/matchDetail.ts`, backed by `src/core/matchDetail.ts`; every section renders only when its data exists, so the page degrades tier-by-tier):
- **Header** (always renders — the only section every record, however old, can fill): result text (Victory/Defeat/Draw, colour-coded), map name, a meta line (map-type pill · game type · role · account · relative time), mental flag pills when the game has them (Tilt, Toxic mates, Leaver, Positive comms), and a side column with round score (`finalScore`, when captured), duration in minutes (when known), and hero pills for every hero played (when any).
- **Scoreboard:** renders when the match has roster data or per-hero stats.
  - Full roster (both teams reported): team blocks labeled "Your team" / "Enemy team", separated by a **VS** divider, the tracked player's team listed first; per row: role glyph, hero, player name ("you" tag on the tracked player's row(s), tinted), a Perks column (only when at least one entry actually reports perks — GEP does not expose perks today, so this column is normally absent, never faked), E / A / D, DMG / HEAL / MIT; the best value in each stat column across every row is highlighted.
  - One team only (the feed only reported the local side): the reported team renders normally, followed by a VS divider and the explicit note "Enemy team not reported by the game feed." — not a blank or a guess.
  - No roster but per-hero stats exist: one row per hero played, all tinted as local-only, sub-headed "only your own line was recorded for this match".
  - Neither roster nor per-hero data: the Scoreboard section is entirely absent (not an empty card).
- **Per-hero tabs:** rendered when the match has at least one per-hero stat line; a segmented tab control (one tab per hero) only appears when the player used 2+ heroes — a single-hero match shows its line with no tab control. Each tab shows eliminations, assists, deaths, KDA (computed as `(elims + assists) / max(deaths, 1)`), damage, healing, and mitigation.
- **Competitive progress:** rendered only for `Competitive` games. Explicitly labeled **"Estimate"** (sub-copy: "estimated from recent results — the game feed does not report rank") — the existing winrate-heuristic progression, not a value read from the game. Shows rank (tier/division) when known, a division-progress bar, and the SR delta over the filtered range.
- **Player History:** always rendered (a hint replaces the list when there's nothing to show). Lists players from this match the tracked player has met in other stored matches, each with a prior-encounter count and, when available, a `W`/`L` split of games played together; derived entirely from locally stored rosters (no separate store, no export). Distinguishes "no roster was recorded for this match" from "no players from this match in your tracked history yet" depending on whether a roster exists at all.
- **Screenshots gallery:** renders the captured images in a grid when end-of-match screenshots exist for the match; renders a collapsed hint ("No screenshots were captured for this match.") otherwise. Screenshots are a best-effort auto-capture ~2s after match end, stored under `userData/data/screenshots/<matchId>/` and served to the renderer through the read-only `vantage-media://` custom protocol (scoped strictly to that directory).
- [qol 2026-07-04] **Prev/next stepping:** the back row carries "← Matches", a "‹ Older / n / N / Newer ›" stepper through the *filtered* match list (buttons disabled at the ends), and the shell registers ← / → (older/newer) and Esc (back to Matches) while a detail page is open.
- No Share/publish affordance anywhere on the page ([confirmed] out of scope).

## Out-of-Scope

- [confirmed] **Share URL** — publishing matches to a shareable web link is out of scope. It would add a second outbound data path beyond Notion export, violating guardrail #5 (local-first; Notion is the only outbound path).
- Pagination, search, and column sorting on the list (not present, not requested).
- Editing match data from the detail page (read-only drill-down).

## Constraints

- **Guardrail #1 (account safety):** all detail-page data comes solely from Overwolf GEP or manual logging. Fields the GEP does not expose are optional/best-effort and simply absent — never sourced by memory reading or injection, never fabricated. The scoreboard may only show information visible on the in-game end-of-match screen (no hidden info).
- [implemented 2026-07-04] **Perks are never faked.** GEP does not report perks today; the Perks column exists in the scoreboard component but only renders when at least one entry in the match actually carries `perks` data — which does not happen with the current feed, so the column is absent in practice, not populated with placeholders.
- [implemented 2026-07-04] **Competitive progress is explicitly an estimate.** The feed does not report rank; `competitive.note` is `'estimate'` for every match today. A `'reported'` note is reserved in the type for a future verified GEP rank upgrade, but nothing produces it yet.
- [implemented 2026-07-04] **Screenshot capture is best-effort and untested against the live ow-electron runtime.** It tries an ow-electron `recorder` package method first (feature-detected at runtime — the package ships no local typings and may not even be provisioned), then falls back to Electron's `desktopCapturer` grabbing the Overwatch window. Every failure path (missing package, no game window found, filesystem error, protocol issue, timeout) is a silently logged no-op; nothing in this pipeline ever throws out of the module or blocks the match-recording pipeline. The spec-sanctioned failure mode is simply a collapsed gallery — this has not been verified end-to-end against a real ow-electron/Overwolf runtime.
- [implemented 2026-07-04] Live GEP matches now persist the **full reported roster** (when the feed provides one) and the round score (`finalScore`) onto the stored `GameRecord`; other players' names/records are **local-only** and are never sent to Notion — the Notion exporter deliberately excludes rosters, screenshots, and review data (guardrail #5: Notion stays a minimal, opt-in export of the player's own tracked-game facts).
- Player History is derived at query time from stored rosters across all history — no separate store, no migration needed for it.
- All stored data stays local-first per guardrail #5.

## Acceptance Criteria

**List:**
- Given matches in the filtered range, when Matches renders, then each row shows result, map, role, heroes (or "—"), account, map type, game type, and relative time, newest first, and is clickable.
- Given matches from today and yesterday, then rows sit under "Today" / "Yesterday" headers (older days get a friendly date), each header showing that day's W–L tally and signed net.
- Given a click on a hero name in a row, then that hero's drill-down drawer opens (no navigation to the detail page); given a click on the map name, then the Maps view opens with that map's bar scrolled into view and flashed.
- Given no matches in range but games outside it, then "No matches in this range yet." is shown with a "Show all time (N games)" button that resets the range filter, plus a "Log a match" button; given no games at all, only "Log a match" is offered.
- Given a click on a match row (outside a cross-link), then the full match detail page for that game opens and the sidebar keeps **Matches** highlighted.

**Match detail page:**
- Given any match, however old or minimal its record, then the header renders with at least result, map, mode, role, account, and relative time.
- Given a match with a recorded round score, duration, or hero list, then the header's side column shows the ones that are present and omits the ones that aren't.
- Given a match with mental flags recorded (quick-log or Review), then the header shows a pill per flag that's set.
- Given the detail page for a game with a full two-team roster, then both teams render with per-player role, hero, name, perks (only if ever reported), E/A/D, DMG/HEAL/MIT, best-per-column highlighting, and the tracked player's row(s) tinted, separated by a VS divider.
- Given the detail page for a game where only the local team was reported, then that team renders normally, followed by "Enemy team not reported by the game feed."
- Given the detail page for a game with per-hero stats but no roster, then the scoreboard shows the tracked player's own hero rows, tinted, sub-headed as local-only.
- Given the detail page for a game with neither roster nor per-hero stats, then the Scoreboard section does not render at all.
- Given the player used multiple heroes, then a segmented tab control renders with one tab per hero, each showing that hero's core line; given exactly one hero, the line shows with no tab control.
- Given a Competitive match, then a "Competitive progress" card renders, explicitly labeled "Estimate", with rank/division/SR-delta when computable; given a non-Competitive match, the section is absent.
- Given players from this match appear in other stored matches, then Player History lists them with prior-encounter counts and, when known, a W/L split; given a roster exists but no prior encounters do, a "no players … yet" hint shows; given no roster at all, a "no roster was recorded" hint shows.
- Given screenshots were captured for this match, then the gallery renders them; given none (including every best-effort capture failure), the section shows the collapsed "No screenshots were captured for this match." hint instead of erroring.
- Given a detail page with a newer match in the filtered list, when I press → or click "Newer ›", then that match's detail renders; ← / "‹ Older" steps the other way; the stepper shows "n / N" and disables at either end; Esc returns to Matches.
- Given any detail page, then no Share/publish affordance is present.

## Known gaps (intent ≠ code)

None identified — behavior matches intent. The following are known, accepted limitations rather than gaps:

- [confirmed] **Competitive progress is an estimate, not a reported rank.** GEP rank-reporting keys are unverified/unavailable today; a future upgrade to a `'reported'` note is accommodated by the type but not implemented.
- [confirmed] **Screenshot capture is unverified against the live ow-electron runtime.** It has only been exercised via the demo dataset and unit tests, not a real Overwatch session; the collapsed-gallery fallback is the intended, spec-sanctioned behavior if capture never succeeds in production.
- [confirmed] **The enemy-team roster may not be reported by the game feed** for every match; the one-team fallback note is the accepted behavior, not a defect.
- [confirmed] **Perks are not provided by GEP** as of this pass; the column stays absent rather than showing placeholder data.

## Open Questions

None — resolved 2026-07-04: destination = full detail page per the design screenshot; Player History, Screenshots gallery, and progress bar in scope; Share URL out of scope. Implemented 2026-07-04.
