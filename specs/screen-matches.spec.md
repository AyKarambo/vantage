# Screen spec: Matches (`matches`)

**Source:** `renderer/src/views/matches.ts`, `renderer/src/views/matchDetail.ts`, `renderer/src/components/scoreboard.ts`, `src/core/matchDetail.ts`, `src/core/playerIndex.ts`, `src/core/analytics/session.ts` (`groupByDay`), `src/main/screenshots.ts`, `renderer/src/prefs.ts` (`MatchColumnsPref`) · reverse-engineered 2026-07-04 · detail-page design from user screenshot (2026-07-04 spec review) · updated 2026-07-04 after gap implementation · updated 2026-07-04 after the ui-qol batch (PR #8) · updated 2026-07-06 after the `feedback-batch-2026-07` Area F fix (configurable per-field display + clean meta line) · updated 2026-07-08 after the configurable grades fields (issue #68)
**Provenance tags:** [explicit] stated in code/comments · [inferred] reconstructed from behavior · [confirmed] user decision (2026-07-04 spec review) · [implemented 2026-07-04] shipped in the gap-closing pass · [qol 2026-07-04] shipped in the ui-qol batch (intent: `ui-qol.spec.md`) · [batch 2026-07-06] shipped in `feedback-batch-2026-07` Area F (intent: `feedback-batch-2026-07.spec.md`) · [#68 2026-07-08] shipped in `match-fields-config` (intent: GitHub issue #68, SDD spec issue #77)

**Shared context:** Renders from a `DashboardData` snapshot via `ViewContext`; the global filter bar re-scopes the list. The match detail page is a parameterized view (`matchDetail`, opened with `{ matchId }`) registered in the view router but outside the sidebar nav list — the sidebar keeps **Matches** highlighted while a detail page is open. Shell-level behaviors that touch this screen — the palette's Match/Map/Hero entries, per-route scroll memory (Matches ↔ matchDetail), and the Esc/←/→ hotkeys — are specified in `screen-shell.spec.md`.

## Intent (WHAT & WHY)

[confirmed] The match history log **with click-through to a full match detail page**. [implemented 2026-07-04] Each row now opens a dedicated detail view built to degrade gracefully across the app's different data-capture tiers (live full-roster GEP captures, partial/local-only captures, and older legacy records) — a minimal record still renders a complete header even when richer sections have nothing to show.

## In-Scope

**List:**
- Newest-first list of matches in the filtered range: result letter (W/L/D, colour-coded), map, map-type pill, relative time — always visible — plus a per-field-configurable set described below. [batch 2026-07-06] The per-row game-type label is **removed** (constant noise once the filter bar is competitive-only — see `dashboard-filter-fixes.spec.md` Area D); map-type pill and result stay.
- Match count in the header (`"N games in range · newest first · click a match for details"`).
- [implemented 2026-07-04] Every row is clickable (`.match-row.is-clickable`) and navigates to `matchDetail` with that row's `matchId`.
- [qol 2026-07-04] **Day grouping:** rows sit under day headers — "Today" / "Yesterday" for the two most recent calendar days, otherwise a friendly date ("Wed, Jul 2") — each header showing that day's `W–L` tally and signed net. Backed by the pure `groupByDay` helper (`src/core/analytics/session.ts`), newest day first, rows newest-first within a day.
- [qol 2026-07-04] **Cross-links inside a row** (clicks `stopPropagation` so the row's detail click stays intact): the map name links to the Maps view with `{ highlight: map }` (scrolled to and flashed there); each hero name links to that hero's drill-down drawer (`openHeroDrawer`).
- [qol 2026-07-04] **Actionable empty state:** an empty range shows "No matches in this range yet." plus next steps instead of a dead end — a "Show all time (N games)" button when unfiltered history has games and the range isn't already all-time (`DashboardData.totalGamesAllTime`), and a "Log a match" button opening the quick-log modal.
- [batch 2026-07-06] **Per-field configurable info ("Customize view").** A "Customize view" affordance (`renderer/src/views/matches.ts`) lets the user set each of nine fields — **role, heroes, account, SR delta, duration, final score**, and [#68 2026-07-08] the grades-oriented **performance, target grades, flags** — independently to `hidden`, `inline`, or `column` (`MatchColumnMode`/`MatchColumnsPref`, `renderer/src/prefs.ts`):
  - `inline` renders the field as a segment of the row's meta line.
  - `column` renders it as its own vertically aligned column across every row, in which case it does **not** also appear inline.
  - Canonical order (both inline segments and columns follow this): role · heroes · account · SR delta · duration · final score · performance · target grades · flags.
  - Defaults (`MATCH_COLUMNS_DEFAULT`): heroes, account, SR delta = `inline`; role, duration, final score = `hidden`; [#68 2026-07-08] performance, target grades, flags = `hidden` (existing rows unchanged until the user opts in — a stored pref from before these keys existed merges them in as `hidden`).
  - The configuration persists across sessions via renderer prefs (`prefs.get('matchColumns')` / localStorage) — restarting the app keeps the chosen layout.
- [batch 2026-07-06] **Clean meta line (no placeholders).** The meta line joins only the segments whose field is `inline` **and** has a non-empty value, separated by `·` — no `—` placeholder for an absent value, no leading/trailing/doubled separators. If zero segments are renderable (e.g. all fields hidden, or all inline fields empty for this row), the meta-line element is omitted entirely rather than rendered empty. A `column`-mode field with no value for a given row renders a blank cell so the column stays aligned.
- [batch 2026-07-06] **Field formatting:** SR delta renders signed and colour-coded (e.g. `+25` green / `−18` red); duration renders in minutes; final score renders as recorded (e.g. `3–1`). Both fields are carried on the `MatchRow` contract (`src/shared/contract/dashboard.ts`): `srDelta?: number` (signed SR change) and `finalScore?: string`, populated by `toMatchRow` (`src/core/dashboardData.ts`).
- [#68 2026-07-08] **Grades-field formatting:** performance renders as a small mono stat (the 0-100 self-rating, `MatchRow.performance`) tinted with the same continuous winrate ramp the performance slider uses; target grades render as compact **Hit / Partial / Missed** pills (win/draw/loss tones) — one per auto-graded measured target from `MatchRow.measuredGrades`, `'no-stat'` entries skipped, the pill tooltip naming the target and measured value; flags render as compact pills per set `MatchRow.flags` key — Tilt, Toxic, Leaver, +Comms, Abusive — with the match-detail header's tones. To feed the target-grades field, `recentMatches` (`src/core/dashboardData.ts`) now passes the active measured-target set into `toMatchRow`, so match-list rows carry `measuredGrades` exactly like review-inbox rows (no contract shape change).

**Match detail page** ([implemented 2026-07-04] `renderer/src/views/matchDetail.ts`, backed by `src/core/matchDetail.ts`; every section renders only when its data exists, so the page degrades tier-by-tier):
- **Header** (always renders — the only section every record, however old, can fill): result text (Victory/Defeat/Draw, colour-coded), map name, a meta line (map-type pill · game type · role · account · relative time), mental flag pills when the game has them (Tilt, Toxic mates, Leaver, Positive comms), and a side column with round score (`finalScore`, when captured), duration in minutes (when known), and hero pills for every hero played (when any).
- **Scoreboard:** renders when the match has roster data or per-hero stats.
  - Full roster (both teams reported): team blocks labeled "Your team" / "Enemy team", separated by a **VS** divider, the tracked player's team listed first; per row: role glyph, hero, player name ("you" tag on the tracked player's row(s), tinted), a Perks column (only when at least one entry actually reports perks — GEP does not expose perks today, so this column is normally absent, never faked), E / A / D, DMG / HEAL / MIT; the best value in each stat column across every row is highlighted.
  - One team only (the feed only reported the local side): the reported team renders normally, followed by a VS divider and the explicit note "Enemy team not reported by the game feed." — not a blank or a guess.
  - No roster but per-hero stats exist: one row per hero played, all tinted as local-only, sub-headed "only your own line was recorded for this match".
  - Neither roster nor per-hero data: the Scoreboard section is entirely absent (not an empty card).
- **Per-hero tabs:** rendered when the match has at least one per-hero stat line; a segmented tab control (one tab per hero) only appears when the player used 2+ heroes — a single-hero match shows its line with no tab control. Each tab shows eliminations, assists, deaths, KDA (computed as `(elims + assists) / max(deaths, 1)`), damage, healing, and mitigation.
- **Competitive progress:** rendered only for `Competitive` games. Explicitly labeled **"Estimate"** (sub-copy: "estimated from recent results — the game feed does not report rank") — the existing winrate-heuristic progression, not a value read from the game. Shows rank (tier/division, Bronze→Champion) when known, a within-division progress bar labelled as a percentage (0–100%), and the signed progress delta (in percentage points) over the filtered range.
- **Edit tracking:** the match header carries an **Edit tracking** ("Add tracking" when ungraded) action that opens a modal to (re-)grade the match's active targets and edit its mental flags — pre-filled from the saved review, saved through the same `saveReview` path the Review screen uses, and clearable. This is the way to change a match's manual read after it was first graded (the Review inbox only surfaces still-ungraded matches).
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
- Given matches in the filtered range, when Matches renders, then each row shows result, map, map type, and relative time (always visible), plus whichever of role/heroes/account/SR delta/duration/final score/performance/target grades/flags are configured `inline` or `column` — newest first, and every row is clickable.
- Given default settings and a match with no recorded heroes, when the list renders, then its meta line joins only the non-empty inline segments (e.g. `MyAccount · +25`) with no `—` placeholder and no dangling separators.
- Given account set to `column` and role set to `inline`, when the list renders and the app is restarted, then account appears as an aligned column (not in the meta line) and role appears inline — in both sessions (persisted via renderer prefs).
- Given all nine configurable fields set to `hidden`, when the list renders, then rows show only the always-visible fields (result, map, map type, relative time) with no empty meta line or spacer.
- Given a match without SR delta while SR delta is `inline`, when the list renders, then that row omits the SR segment; with SR delta as `column`, the cell is blank but the column stays aligned.
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
- Given a Competitive match, then a "Competitive progress" card renders, explicitly labeled "Estimate", with rank tier/division, a within-division progress percentage, and the signed percentage-point delta when computable; given a non-Competitive match, the section is absent.
- Given any match (graded or not), then an "Edit tracking" / "Add tracking" action in the header opens a modal to grade its active targets and edit its mental flags, pre-filled from the saved review and saved through the existing review path; clearing the review removes it.
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
