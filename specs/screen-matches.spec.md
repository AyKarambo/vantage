# Screen spec: Matches (`matches`)

**Source:** `renderer/src/views/matches.ts`, `renderer/src/views/matchDetail.ts`, `renderer/src/components/scoreboard.ts`, `renderer/src/components/roleIcon.ts`, `src/core/matchDetail.ts`, `src/core/playerIndex.ts`, `src/core/analytics/session.ts` (`groupByDay`), `src/core/rankDisplay.ts` (`rankParts`), `renderer/src/prefs.ts` (`MatchColumnsPref`).

**Shared context:** Renders from a `DashboardData` snapshot via `ViewContext`; the global filter bar re-scopes the list. The match detail page is a parameterized view (`matchDetail`, opened with `{ matchId }`), registered in the router but outside the sidebar nav list — the sidebar keeps **Matches** highlighted while a detail page is open. Shell-level behaviours that touch this screen (the palette's Match/Map/Hero entries, per-route scroll memory, the Esc/←/→ hotkeys) live in `screen-shell.spec.md`.

## Intent

The match history log with click-through to a full match detail page. Each row opens a dedicated detail view that degrades gracefully across the app's data-capture tiers (live full-roster GEP captures, partial/local-only captures, older legacy records) — a minimal record still renders a complete header even when richer sections have nothing to show.

## List

- Newest-first list of matches in the filtered range. Always visible: result letter (W/L/D, colour-coded), map, map-type pill, relative time. Every row is clickable (`.match-row.is-clickable`) and navigates to `matchDetail` with that row's `matchId`. There is no per-row game-type label (the app is competitive-only).
- Header count: `"N games in range · newest first · click a match for details"`.
- **Day grouping:** rows sit under day headers — "Today" / "Yesterday" for the two most recent calendar days, otherwise a friendly date ("Wed, Jul 2") — each header showing that day's `W–L` tally and signed net (pure `groupByDay`, `src/core/analytics/session.ts`).
- **Cross-links inside a row** (`stopPropagation` so the row's detail click stays intact): the map name links to the Maps view with `{ highlight: map }` (scrolled to and flashed there); each hero name links to that hero's drill-down drawer (`openHeroDrawer`).
- **Actionable empty state:** an empty range shows "No matches in this range yet." plus a "Show all time (N games)" button (when unfiltered history has games and the range isn't already all-time) and a "Log a match" button opening the quick-log modal.
- **Per-field configurable info ("Customize view").** A "Customize view" affordance lets the user set each of nine fields — **role, heroes, account, SR delta, duration, final score, performance, target grades, flags** — independently to `hidden`, `inline`, or `column` (`MatchColumnMode`/`MatchColumnsPref`, `renderer/src/prefs.ts`):
  - `inline` renders the field as a segment of the row's meta line; `column` renders it as its own vertically aligned column across every row (and then it does **not** also appear inline).
  - Canonical order (inline segments and columns alike): role · heroes · account · SR delta · duration · final score · performance · target grades · flags.
  - Defaults (`MATCH_COLUMNS_DEFAULT`): heroes, account, SR delta = `inline`; role, duration, final score, performance, target grades, flags = `hidden`. A pre-existing stored pref merges any newer keys in as `hidden`.
  - The configuration persists across sessions via renderer prefs (`prefs.get('matchColumns')`).
- **Clean meta line (no placeholders).** The meta line joins only the `inline` segments with a non-empty value, separated by `·` — no `—` placeholder, no leading/trailing/doubled separators; if zero segments are renderable the meta-line element is omitted entirely. A `column`-mode field with no value for a row renders a blank cell so the column stays aligned.
- **Field formatting:** the **role** field renders as a **role icon** (the shared `roleIcon` component — shield/reticle/support-cross/neutral, `currentColor`-tinted). SR delta renders signed and colour-coded (`+25` / `−18`); duration in minutes; final score as recorded (`3–1`). Performance renders as a small mono stat (the 0–100 self-rating) tinted with the winrate ramp; target grades render as compact **Hit / Partial / Missed** pills, one per auto-graded measured target (`'no-stat'` entries skipped); flags render as compact pills per set flag key (Tilt, Toxic, Leaver, +Comms, Abusive). `srDelta` and `finalScore` ride the `MatchRow` contract (`src/shared/contract/dashboard.ts`); `measuredGrades` is passed into `toMatchRow` so list rows carry grades exactly like review-inbox rows.

## Match detail page

`renderer/src/views/matchDetail.ts`, backed by `src/core/matchDetail.ts`; every section renders only when its data exists, so the page degrades tier-by-tier.

- **Header** (always renders): result text (Victory/Defeat/Draw, colour-coded), map name, a meta line (map-type pill · role · account · relative time), mental flag pills when present (Tilt, Toxic mates, Leaver, Positive comms), and a side column with round score (`finalScore`, when captured), duration in minutes (when known), and hero pills for every hero played (when any).
- **Scoreboard:** renders when the match has roster data or per-hero stats.
  - Full roster (both teams reported): team blocks "Your team" / "Enemy team" separated by a **VS** divider, the tracked player's team first, ordered **5v5** (Tank → DPS → DPS → Support → Support). Each row: a **role icon** (role derived from the hero when the feed omits it), hero, player name ("you" tag on the tracked player's row, tinted), a Perks column (only when at least one entry actually reports perks — GEP does not expose perks today, so it's normally absent, never faked), E / A / D, DMG / HEAL / MIT; the best value in each stat column is highlighted.
  - One team only: the reported team renders normally, followed by a VS divider and "Enemy team not reported by the game feed."
  - No roster but per-hero stats exist: one row per hero played, all tinted as local-only, sub-headed "only your own line was recorded for this match".
  - Neither roster nor per-hero data: the Scoreboard section is absent.
- **Per-hero panel:** rendered when the match has at least one per-hero stat line; a segmented tab control (one tab per hero) appears only when the player used 2+ heroes. Hero-swap segments on the **same hero merge into one chip/row per hero**. Each hero shows its stats **per 10 minutes** — Elims/10, Assists/10, Deaths/10, DMG/10, HEAL/10, MIT/10 — and **KDA as a ratio** (`(elims + assists) / max(deaths, 1)`). Per-10 rates are dashes when the match's minutes are unknown.
- **Competitive progress:** rendered only for `Competitive` games, composed through the shared rank renderer (`rankParts`) — the tier/division label, a 🛡 "Rank protected" pill and a buffer hint when the rank is protected, else a within-division progress bar. A per-match SR change (`±N% this match`) is shown when set. The card's note is labelled honestly — **Calculated** (from the rank anchor + logged SR), **Reconstructed** (backward from the anchor, may drift), **Estimate** (winrate heuristic when no anchor is set), or **Reported** (reserved for a future verified GEP rank). There is no "set %" / "Demoted" / re-anchor affordance on the page.
- **Edit match:** the header carries an **✎ Edit match** action opening the match editor. The game facts (result/role/map/heroes) **and** the manual layer are editable on **every** match — an auto-tracked (GEP) result the feed got wrong (a leaver scored as a loss, a misread draw) can be hand-corrected. Such a correction keeps the record's **⚡ auto** provenance (`source` stays `gep`) and tags it **edited** — a subtle marker in the detail header and on the editor's provenance line; the original feed value is not preserved (no revert), and the game-feed round score/scoreboard are left as-is even when they now contradict the corrected result. The manual layer is mental flags (incl. leaver-team), the per-match SR %, and the active targets' grades. Saves go through `editMatch` (which stamps `factsEditedAt` on a real fact change); `ctx.refresh()` re-pulls the detail so dependent views update.
- **Player History:** always rendered (a hint replaces the list when there's nothing to show). Lists players from this match the tracked player has met in other stored matches, each with a prior-encounter count and, when available, a `W`/`L` split; derived entirely from locally stored rosters. Distinguishes "no roster was recorded for this match" from "no players from this match in your tracked history yet".
- **Prev/next stepping:** the back row carries "← Matches" and a "‹ Older / n / N / Newer ›" stepper through the *filtered* list (disabled at the ends); the shell registers ← / → (older/newer) and Esc (back to Matches) while a detail page is open.

## Out-of-Scope

- **Share URL** — publishing matches to a shareable web link is out of scope (it would add a second outbound path beyond Notion, violating guardrail #5). No Share/publish affordance appears anywhere.
- **End-of-match screenshots** — there is no screenshot capture, storage, or gallery. The feature was removed; the detail page has no screenshots section.
- Pagination, search, and column sorting on the list (not present).

## Constraints & edge cases

- **Guardrail #1 (account safety):** all detail-page data comes solely from Overwolf GEP or manual logging. Fields the GEP does not expose (perks, live rank) are optional/best-effort and simply absent — never memory-read, injected, or fabricated. The scoreboard may only show information visible on the in-game end-of-match screen.
- Live GEP matches persist the **full reported roster** (when provided) and the round score onto the stored `GameRecord`; other players' names/records are local-only and never sent to Notion (the exporter excludes rosters and review data).
- Player History is derived at query time from stored rosters across all history — no separate store.
- All stored data stays local-first (guardrail #5).
