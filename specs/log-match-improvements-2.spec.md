---
slug: log-match-improvements-2
status: done
created: 2026-07-07
updated: 2026-07-07
---

# Spec: Log Match screen improvements (round 2)

**Surface:** `renderer/src/app/log-match.ts`, `renderer/src/components/{typeahead,heroPicker}.ts`,
`renderer/src/views/{review,matchDetail,settings}.ts`, `renderer/src/components/reviewControls.ts`,
`renderer/src/prefs.ts`, `src/shared/contract/{inputs,dashboard}.ts`, `src/core/analytics/types.ts`,
a new slider component/styles.

## Intent (WHAT & WHY)

The first log-match pass (`log-match-improvements`, shipped) fixed multi-hero capture, role-filtered
heroes, SR presets, and comms tone. Five rough edges remain on the same card:

1. **The map field can still hold garbage between keystrokes and save.** It's free text validated
   only when you hit save (an inline error appears *after* you've typed something invalid). It
   should be impossible to end up with an unresolvable map at all.
2. **The hero grid is still one long list per role.** Even role-filtered, Tank/Damage/Support pools
   run 12–19 heroes — most of which a given player never touches. Since most people play a handful
   of heroes on repeat, the card should default to *their* most-played few and offer search as the
   path to anything else — shrinking the card for the common case without losing reach for the rest.
3. **"Set current rank" starts from scratch every time.** It opens at hardcoded Gold/3/blank instead
   of the rank already on file for the account+role, so fixing a one-tier drift means re-entering the
   whole position instead of nudging it.
4. **The Set-current % field is the only numeric input on the card without wheel nudge.** The
   Change-mode SR delta already increments/decrements ±1 per scroll tick; the % field under
   Set-current doesn't, so drift-correction still needs the keyboard.
5. **There's no way to record how a match *felt* to play, only how it went (grades) and the mood
   around it (comms/tilt/toxic-mates).** A simple self-rated performance number closes that gap.

Benefit: a map field that can never desync from reality, a hero picker that's fast for the 90% case
and still reaches everything, rank correction that starts from where you actually are, full wheel
parity on the SR inputs, and a lightweight self-performance signal captured wherever a match gets
touched — without slowing the card down or weakening account safety (still 100% manual entry).

## In-Scope

- **Map field becomes a locked combobox.** Same type-to-search box, same suggestion ordering (recent
  maps first, then the rest of the active pool) when the query is empty; once the user types, the
  filtered results widen to the *full* map set (active + inactive), with inactive entries shown
  muted/deprioritized (same visual language the master-data editor already uses for inactive maps).
  The committed value can only ever be an exact (case-insensitive) known map name — selecting a
  suggestion commits it; leaving the field with unmatched text reverts to the last committed valid
  value (or empty). The "Log match" action stays blocked while the field holds no committed value.
  Inactive maps remain loggable by name (preserves `editable-master-data` AC 21/22) — they're just
  never in the default no-query suggestion list.
- **Hero picker defaults to a "most played" shortlist, searchable for the rest.** For the selected
  role (Tank/Damage/Support, or Open Queue = all heroes), show only the top **N** heroes by play
  count *for the account currently selected in the form*, using the existing
  `heroStats`/`heroStats`-shaped ranking (already sorted by games played) filtered to that role and
  account, and re-ranked on role/account change. A search input alongside the shortlist filters the
  full role-eligible pool (same as today's full grid) so any hero is still one search away; a
  searched hero toggles into the selection exactly like a shortlist chip. Fewer than N played heroes
  for that role/account ⇒ just show what's there (no padding with unplayed heroes). Already-selected
  off-role heroes keep appearing on role switch — unchanged from today.
- **New setting: suggested hero count (N).** A small numeric preference (client-side, same pattern
  as the existing `minGames` Heroes-table pref in `renderer/src/prefs.ts`), editable in Settings,
  default **6**, clamped to a sane range (e.g. 3–15). Changing it re-renders the shortlist size
  everywhere the hero picker appears.
- **"Set current rank" prefills from the existing anchor.** When an account+role already has a
  recorded rank, opening Set-current mode seeds tier/division/% from that current position (mirrors
  `openSetRank()`'s prefill in Settings) instead of the hardcoded Gold/3/blank defaults. The
  first-time-anchor case (no rank recorded yet for that account+role) keeps today's defaults — there's
  nothing to prefill.
- **Set-current % field gets wheel nudge.** Same ±1-per-scroll-tick behavior as the existing SR-delta
  field (`numInput()` wheel pattern), including not scrolling the modal while the pointer is over it.
- **Performance slider: a 0–100 self-rating per match.** One optional integer field per match
  (not per-hero). Starts **unset** ("not rated") — an unset slider is visually distinct from a
  0-value slider (empty/faded track, no committed thumb position) and has an explicit clear (×)
  affordance once set, matching the optional/clearable pattern already used for SR delta and comms.
  Fill color uses the existing continuous winrate ramp (`wrColor`/`wrHue`) so low ratings read red
  and high read green, consistent with how winrate is colored elsewhere (light/dark and CVD-palette
  aware, since those tokens already flip under `html[data-cvd]`). Available and settable in:
  - the **Log Match** card (rate right after the game), and
  - the **Review** grading card (rate — or adjust — during the review pass), and
  - the **match-detail editor** (`renderer/src/views/matchDetail.ts`), since it shares
    `reviewControls.ts` with Review and would otherwise be the one editing surface where a
    previously-set rating can't be seen or changed.
  Persisted as a new optional `performance?: number` field: on `GameRecord` (top-level, alongside
  `srDelta`), threaded through `ManualMatchInput` (log-match save) and `MatchEditInput`
  (match-detail save), and added to the Review save payload (`bridge.saveReview`) so Review can set
  it alongside grades/flags in the same action. No SQLite schema/column change needed — it rides in
  the existing JSON blob like every other optional `GameRecord` field.
- Unit tests for changed pure logic: hero most-played ranking/shortlist selection, map name
  resolution against the full (active+inactive) set unchanged, `performance` field round-trips
  through any pure transform it touches.

## Out-of-Scope (non-goals)

- **Any new analytics/trend surfacing of the performance value**, and **using it as a readiness
  input.** Deliberately capture-and-display only this pass — tracked as a follow-up:
  [GitHub issue #44](https://github.com/AyKarambo/vantage/issues/44).
- **Notion export/import of the performance field.** Not mirrored to Notion this pass (no schema
  change on the Notion side).
- Redesigning the comms switch, flag chips, or target-grading rows — unchanged.
- Per-hero attribution of the performance rating (it's one number per match, not per hero).
- Reworking the master-data "Update" fetch/preview flow or `isActive` semantics — untouched.
- Keyboard shortcuts for the new slider beyond whatever the shared component naturally gets from
  focus/arrow-key native range-input behavior.

## Constraints

- **Guardrails hold:** `src/core/` pure/Electron-free; renderer CSP-friendly (native
  `<input type="range">`, no new dependency); IPC typed end-to-end (no `any`); manual-only,
  local-first (the performance rating is local like everything else pre-Notion).
- **Composition over markup:** the locked map combobox extends the existing `typeahead` component
  (or a strict variant of it) rather than a bespoke input; the hero search reuses the existing
  chip/grid + a plain text filter; the slider is a new composed component under
  `renderer/src/components/`, styled from `tokens.css` variables only (no hardcoded hex), themed
  correctly under both light/dark and the CVD palette swap.
- **No SQLite migration required:** `performance?` rides in the JSON blob (`history.ts`'s `data`
  column) exactly like `srDelta`/`mental`/`review` do today.
- **Backward compatibility:** existing `GameRecord`s without `performance` read as unset everywhere;
  existing map/hero data and the master-data editable/updatable pipeline are untouched.
- **DoD:** `npm test` green; `npm run typecheck` clean (main + renderer); new pure `core/` logic
  (hero ranking selection, any map-resolution changes) ships with vitest tests; README/docs updated
  for user-visible changes (new setting, new slider).

## Acceptance Criteria

### Map field — locked combobox
- **Given** the map field is empty and unfocused, **when** it gains focus with no query typed,
  **then** suggestions show recent maps first, then the rest of the active pool — unchanged from
  today.
- **Given** the user types a query, **when** results are filtered, **then** matches from the full
  map set (active + inactive) appear, with inactive maps visually muted/deprioritized beneath active
  matches.
- **Given** a suggestion is selected (click or keyboard-confirm), **then** that exact map name is
  committed as the field's value.
- **Given** the user types text that doesn't exactly (case-insensitively) match any known map name,
  **when** the field loses focus, **then** the field reverts to the last committed valid value (or
  empty if none was ever committed) — it never holds unresolvable text.
- **Given** the map field holds no committed value, **when** the user tries to save, **then** the
  "Log match" action is blocked (not merely erroring after the attempt).
- **Given** a map toggled inactive in master data, **when** the user types its exact name in
  log-match, **then** it still resolves and the match can be logged on it (AC 21/22 of
  `editable-master-data.spec.md` preserved).

### Hero picker — most-played shortlist + search
- **Given** a role and account are selected, **when** the hero picker renders, **then** it shows at
  most **N** heroes (the configured suggested-hero-count), ranked by that account's play count for
  that role (Open Queue ranks across all heroes for the account), same chip-grid interaction as
  today.
- **Given** fewer than N heroes have been played for that role/account, **then** only the played
  heroes appear as shortlist chips — no unplayed heroes are added to fill the count.
- **Given** the search input, **when** the user types a hero name, **then** matching heroes from the
  full role-eligible pool appear (including ones outside the shortlist) and can be toggled into
  selection exactly like a shortlist chip.
- **Given** heroes selected while on one role, **when** the role changes, **then** already-selected
  off-role heroes remain visible and selected — unchanged from today.
- **Given** the user changes the suggested-hero-count setting, **then** every hero picker (log-match,
  and anywhere else it's reused) reflects the new shortlist size on next render.

### Suggested hero count setting
- **Given** Settings, **then** a numeric control sets the suggested hero count, persisted client-side
  (survives restart), defaulting to 6 for a fresh install, clamped to a sane bound.

### Rank — Set current rank prefill
- **Given** an account+role with an existing recorded rank, **when** the user switches the log-match
  card to "Set current rank" mode, **then** tier/division/% prefill from that existing rank (not
  hardcoded defaults).
- **Given** an account+role with **no** recorded rank yet, **when** "Set current rank" mode opens,
  **then** it falls back to today's defaults (Gold/3/blank) — there's nothing to prefill.
- **Given** the Set-current % field, **when** the pointer is over it and the user scrolls, **then**
  the value changes ±1 per tick and the modal does not scroll — identical behavior to the existing
  SR-delta field.

### Performance slider
- **Given** a match with no performance rating set, **then** the slider renders in a visually
  distinct "not rated" state (not defaulted to 0 or 50).
- **Given** the user drags/clicks/keys the slider to a value, **then** it commits an integer 0–100
  and the fill color follows the continuous winrate ramp (red low → green high), matching the app's
  light/dark/CVD theming.
- **Given** a rating is set, **when** the user activates the clear affordance, **then** the rating
  returns to unset.
- **Given** the slider is used in the Log Match card, **when** the match is saved, **then**
  `performance` is persisted on the `GameRecord`.
- **Given** a match already has a performance rating, **when** it's opened in the Review grading
  card or the match-detail editor, **then** the current rating shows and can be changed or cleared
  there, and saving either surface persists the update to the same `GameRecord.performance` field.
- **Given** a `GameRecord` from before this change (no `performance` field), **when** it's read
  anywhere, **then** it behaves as unset — no migration needed.

### Regression
- **Given** the full change, **when** `npm test` and `npm run typecheck` run, **then** both pass,
  with new tests covering hero shortlist ranking, map resolution against the extended (active +
  inactive) search set, and `performance` round-tripping through `GameRecord`/`ManualMatchInput`/
  `MatchEditInput`/the Review save payload.

## Resolved questions

1. **Map enforcement mechanism** → locked combobox (type-to-search retained, commit restricted to
   exact known names); inactive maps stay reachable by search (muted), just excluded from the
   default no-query suggestion list — preserves existing master-data acceptance criteria.
2. **Hero shortlist scope** → per role **and** per the account selected in the form; Open Queue
   ranks across all heroes for that account.
3. **Suggested-hero-count setting** → client-side pref (same pattern as `minGames`), default 6,
   lives in Settings.
4. **Set-current rank prefill** → seeds from the existing anchor when one exists; unchanged
   (hardcoded defaults) when there isn't one yet.
5. **SR wheel parity** → the Set-current % field gets the identical wheel ±1 behavior already used
   by the SR-delta field.
6. **Performance slider color** → continuous winrate ramp (`wrColor`/`wrHue`), not a flat accent or
   stepped three-band color.
7. **Performance slider scope** → capture + display only this pass (Log Match, Review,
   match-detail); analytics surfacing and readiness-scoring integration are explicitly deferred to
   [issue #44](https://github.com/AyKarambo/vantage/issues/44), not built now.
8. **Performance slider data model** → one optional 0–100 integer on `GameRecord`, not nested under
   `review`, not per-hero; no SQLite migration needed (JSON blob).
9. **Notion** → performance rating is not exported/imported this pass.

## Open Questions

*None outstanding — ready to plan.* Fine-grained details (exact locked-combobox keyboard semantics,
whether the slider shows a numeric readout alongside the track, the precise clamp bounds for the
suggested-hero-count setting) are left for the techplan to settle with tests.

## Post-implementation refinements (2026-07-07)

Two follow-up changes made after the first implementation landed, from live use of the card:

1. **One-time rank setup removed; first-timers default to "Set current rank".** The Change-mode SR
   field used to render a *separate* "Current rank — set once" tier/division/% picker whenever no
   anchor existed for the (account, role). With the Change ↔ Set-current toggle already covering
   both intents, that duplicate block was confusing (it read as if both modes were active at once).
   It's removed: instead, when the card opens for an (account, role) with **no** anchor yet, it now
   **opens in "Set current rank" mode** so the starting rank is established there. Change mode with
   no anchor shows a hint pointing at the toggle, and only "Set current rank" ever writes an anchor
   on save (Change mode records the `srDelta` only).
2. **Two-column card layout.** The card grew long enough to scroll. It's now a two-column grid — the
   **match facts** (result, account, map, role, played, heroes, skill rating) on the left and the
   **manual self-report** (performance, comms, flags, target grades) on the right — in a wider
   modal, collapsing back to one column on a narrow viewport. Save actions span full width below.

**Note on the accounts/log-match mismatch that prompted #1:** the top-left account switcher (and the
filter bar) list accounts *derived from the games in view* (`DashboardData.options.accounts =
distinct(games.map(g => g.account))`), whereas Settings › Accounts and the log-match account picker
list *configured* accounts (`config.accounts`, via `listAccounts()`). In demo mode the sample games
carry account labels that were never configured, so the switcher shows them but Settings is empty and
the log form falls back to `You` — which (having no anchor) is what triggered the one-time setup.
This is expected for demo data (and for any history whose accounts aren't in config); not changed
here — seeding configured accounts from history is a separate concern.
