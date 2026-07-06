# Spec: Feedback Batch 2026-07

**Slug:** `feedback-batch-2026-07`
**Status:** Approved 2026-07-06
**Date:** 2026-07-06

## Intent (WHAT & WHY)

A batch of seven user-reported problems across the Notion round-trip, onboarding, filtering,
the readiness view, the matches list, and the shortcuts cheatsheet. Common themes:

1. **The Notion round-trip is not trustworthy.** Exported rows are missing the
   `Improvement Target` and `Comms` values the user recorded in the app, and re-importing
   rows the user graded *in Notion* floods the Review queue with "pending" matches instead
   of accepting those grades. The product promise — match history flows to the user's own
   Notion workspace and back without loss — is broken in both directions.
2. **The UI contradicts the product's focus.** Vantage exists to track *competitive*
   games, yet the filter bar offers a mode filter; the time filter offers only rolling
   windows plus the current season — no named or past seasons; the account filter
   duplicates the account switcher. The readiness view sits under a filter bar although
   its content deliberately ignores every filter.
3. **Data safety & information density.** Only the history database can be relocated
   today (not the rest of the data, and not at first run), the matches list wastes space
   and renders a confusing `Damage · — · account` meta line, and the shortcuts cheatsheet
   has visibly broken padding.

Areas below are labeled **A–G** and map 1:1 onto the GitHub issues to be created after
approval.

---

## Area A — Notion export: `Improvement Target` & `Comms` columns

### Problem
The user reviews matches in the app (target grades + positive-comms flag), but the
corresponding Notion rows show empty `Improvement Target` / `Comms` cells.

**Confirmed root causes** (verified in code during spec review):

1. **Create-only export.** Export runs only when the user clicks "Sync N games to Notion"
   (`renderer/src/views/notion/syncCard.ts:19-30`). The exporter only *creates* pages
   (`src/notion/notionWriter.ts:61-126` — there is no `pages.update` anywhere in `src/`),
   discards the created page id (`src/notion/notionExporter.ts:38-47`), and marks the
   matchId processed forever (`outbox.isProcessed`, `notionExporter.ts:31-35`). Any match
   synced before it was reviewed keeps empty subjective cells permanently. (The outbox's
   pending/retry queue is dead code — it is used only as a processed-id list.)
2. **In-app grades never reach the export column.** The exporter reads only
   `review.grades[NOTION_IMPROVEMENT_TARGET_ID]` (`notionExporter.ts:45`) — an internal
   slot that in-app reviews never populate: the Review screen grades the user's authored
   targets under their own ids. So even "review first, then sync" leaves the column empty.
3. Both columns are *optional subjective* properties — written only when they exist in
   the live database with the exact name and `select` type; otherwise **silently
   skipped** (`src/notion/gametrackerSchema.ts:79-94`).

### Requirements
- A1. **Derived improvement grade.** The value exported to `Improvement Target` is derived
  from the review's target grades by the **aggregate rule**: all graded targets `hit` →
  `hit`; all `missed` → `missed`; any mix (or any `partial`) → `partially`. A
  single-target review passes its grade through unchanged. Precedence: if the review has
  in-app target grades, the aggregate wins; otherwise an import-created bookkeeping grade
  (Area B) is used as-is.
- A2. **Update on sync.** The manual sync updates the existing Notion pages of
  already-exported matches whose review or mental flags changed since their last export —
  in place, no duplicate rows. This is symmetric: setting values fills cells, clearing a
  flag/grade locally clears the corresponding cell on the next sync. If the Notion page
  was deleted/archived in the meantime, the row is recreated and this is noted in the
  sync result. Updates ride the explicit sync action only (guardrail 5 — no automatic
  outbound traffic). Requires persisting a matchId→pageId map or querying by the
  `Match ID` column — techplan decision.
- A3. **No silent column skips** *(spec addition — veto if unwanted)*. The Notion screen
  shows a per-column sync status: written / skipped, with reason (column missing, wrong
  type, no value). A near-miss column name — one that matches after trimming whitespace
  and case-folding — is called out explicitly.

### Acceptance criteria
- **Given** a Gametracker with `Improvement Target` and `Comms` (both select) and a local
  match reviewed with a single target graded `hit` and `positiveComms` flagged,
  **when** the user syncs,
  **then** the new Notion row has `Improvement Target = hit` and `Comms = positive`.
- **Given** a match reviewed with three targets graded hit / hit / missed,
  **when** it is exported,
  **then** the Notion row has `Improvement Target = partially`.
- **Given** a match already exported with empty subjective cells,
  **when** the user completes its review (grades aggregating to `partially`, positive
  comms) — even while offline — and later runs a successful sync,
  **then** the *existing* Notion page is updated in place to `Improvement Target =
  partially`, `Comms = positive`; no duplicate row exists.
- **Given** an exported match with `Comms = positive` in Notion,
  **when** the user removes the positive-comms flag and syncs,
  **then** the Notion `Comms` cell is cleared.
- **Given** an exported match whose Notion page the user deleted,
  **when** the next sync runs,
  **then** the row is recreated and the sync result mentions it.
- **Given** a Gametracker where `Comms` exists as a *text* column,
  **when** the user opens the Notion screen or syncs,
  **then** a visible status reports `Comms: skipped — wrong type (expected select)`.
- **Given** a Gametracker column named `comms ` (trailing space) or `improvement target`
  (wrong case),
  **when** the user opens the Notion screen,
  **then** the status calls out the near-miss name explicitly.

---

## Area B — Notion import: accept grades, stop flooding the Review queue

### Problem
The user fills `Improvement Target` (a proper select with `hit`/`partially`/`missed`) in
Notion, then imports — and the matches still appear as pending reviews: import
de-duplicates by `matchId` and **skips existing rows entirely**, so grades added in Notion
after the original export never reach the local match (`review == undefined` → pending).
Additionally, the first grade-carrying import seeds a *visible* synthetic target named
"Improvement Target" (`src/main/dataProvider.ts:198-213`, factory in
`src/notion/notionImporter.ts:33-45`), which pollutes the Targets/Review screens.

### Requirements
- B1. **Merge on re-import.** When an imported row's `matchId` exists locally and the
  local match has **no review**, the Notion grade is applied (bookkeeping review created,
  see B2). Locally recorded reviews are never overwritten — local wins. Mental flags
  (`Comms`, `Tilt`, `Toxic Mates`, `Leaver`) merge only when the local match has **no
  mental record at all**; an existing local mental record wins wholesale, even for
  individually unchecked flags. *(Flag merging is a symmetry addition — veto if
  unwanted.)* Note: if the user clears a match's grades locally (review removed), a later
  import legitimately re-applies the Notion grade — intended.
- B2. **Hidden bookkeeping, no visible target.** Imported grades are stored on the match
  review under the internal id (`notion-improvement-target`) — but no `AuthoredTarget` is
  seeded or shown, on any path (merge or brand-new row). Targets screen, Review-screen
  grading, target scoring and progression never display or count the internal id. Matches
  carrying such a review count as reviewed (not pending). Rows with a grade and no local
  counterpart arrive *already reviewed*.
- B3. **Migration.** Existing installs get the previously seeded synthetic target
  (matched **by id**) removed from the manual store; stored grades on matches are
  untouched. The existing `seededBefore` guard already prevents re-seeding afterwards. A
  user-authored target that merely shares the name is unaffected.
- B4. **Round trip stays symmetric.** A bookkeeping grade exports back to the
  `Improvement Target` column (per A1's precedence).

### Acceptance criteria
- **Given** a local match without review whose Notion row has `Improvement Target =
  missed`,
  **when** the user imports,
  **then** the local match has a review with grade `missed`, no longer counts as pending,
  and no duplicate is created.
- **Given** a Notion row with `Improvement Target = hit` and **no** local counterpart,
  **when** the user imports,
  **then** a new local match exists, already reviewed (grade `hit`), not in the pending
  queue.
- **Given** a local match the user already reviewed in the app,
  **when** an import runs with a different grade in Notion,
  **then** the local review is unchanged.
- **Given** a local match with a mental record where `tilt` is unchecked,
  **when** the Notion row has `Tilt` checked and an import runs,
  **then** the local flag stays unchecked (local record wins).
- **Given** any completed import,
  **when** the user opens the Targets or Review screens,
  **then** no "Improvement Target"/imported target is listed anywhere, and target
  success-rate stats are unaffected by imported grades.
- **Given** an existing install with the old synthetic target **and** a user-authored
  target also named "Improvement Target",
  **when** the app starts after the update,
  **then** only the synthetic one is gone; the user's target and all its grades are
  untouched, and previously imported grades remain on their matches.
- **Given** a match whose only review was created by import,
  **when** it is exported or its row updated,
  **then** the Notion `Improvement Target` cell carries that grade.

---

## Area C — Choose the data folder (first run + Settings)

### Problem
Settings already has a "Data & backup" card that relocates **only `history.db`**
(`renderer/src/views/settings.ts:59-85`, `src/store/history.ts:243-272` — copy, verify,
then delete, refusing a target that already holds a DB). Everything else —
`manual.json`, `outbox.json`, `rankAnchors.json`, `screenshots/`, and the frozen legacy
`history.json` backup — stays pinned to `userData/data` (`src/main/index.ts:71-72,99-102`),
and nothing is offered at first run. Users who want their data in a synced folder
(OneDrive) for backup can't get all of it there, and new users aren't asked at all.

### Requirements
- C1. **First-run step.** On first launch (alongside the existing demo-data prompt,
  before meaningful data is written) the app asks where to store data: default
  (`userData/data`, preselected) or a custom folder via native directory picker. The
  choice is validated (creatable + writable); an invalid choice shows the specific reason
  and re-prompts, writing nothing to the invalid location. If the chosen folder already
  contains Vantage data (a `history.db`), it is **adopted as-is** — the restore-from-
  backup flow; no migration, no overwrite.
- C2. **Settings.** The existing card (renamed "Data storage") shows the current folder
  and offers "Change…", now migrating **all** data files — `history.db`, `manual.json`,
  `outbox.json`, `rankAnchors.json`, `screenshots/`, plus legacy `history.json` when
  present — with the existing copy-verify-then-delete guarantee: originals are removed
  only after the switch is committed; failures leave the old location fully intact.
  Missing optional files are skipped, not errors. If the target folder already contains
  Vantage data, the app offers **adopt or cancel** — it never overwrites existing data.
- C3. The pointer (config.local.json) stays in `userData` so the app can always find its
  data; all data files above live under the chosen folder.
- C4. UI copy carries one neutral note: synced folders are great for backup; avoid two
  machines writing at the same time. *(Copy is a spec addition — veto if unwanted.)*
- C5. **Existing installs see no prompt** (first-run detection: data already present in
  the current data dir); their data stays put until they use Settings. NSIS installer
  changes are out of scope.

### Acceptance criteria
- **Given** a fresh install,
  **when** the app launches for the first time,
  **then** the user is asked for a data location with the default preselected, and all
  subsequently written data files land in the chosen folder.
- **Given** the first-run picker,
  **when** the user selects a non-writable folder,
  **then** the specific reason is displayed, the picker is offered again, and nothing was
  written there.
- **Given** a fresh install pointed at a OneDrive folder containing a previous
  installation's data,
  **when** first run completes,
  **then** that data is adopted (matches, targets, settings-relevant stores load from it)
  and none of it was overwritten.
- **Given** an existing install with data in the default location,
  **when** the user changes the data folder in Settings to an empty writable folder,
  **then** all data files (including screenshots and legacy `history.json` if present)
  are moved, the old location is left without stale copies, and a re-launch loads the
  same history from the new location.
- **Given** a Settings folder change targeting a folder that already contains Vantage
  data,
  **when** the user confirms "adopt",
  **then** the app switches to that folder's data without overwriting it; current data
  stays intact in the old location. Cancel changes nothing.
- **Given** a migration target that is not writable,
  **when** the user tries to change to it,
  **then** the change is rejected with a clear error and the old location remains active.
- **Given** an existing install updating to this version,
  **when** the app launches,
  **then** no data-location prompt appears and data stays in place.

---

## Area D — Filter bar rework: competitive-only, real seasons, no account filter

### Problem
- The mode filter (All/Competitive/…) contradicts the app's competitive-only purpose —
  and the `logFilter` config that suggests capture filtering is **dead code**:
  `shouldLog` (`src/core/matchFilter.ts:42-53`) has no callers, so despite the
  `Competitive` default, quick-play/arcade games are recorded today
  (`src/main/matchPipeline.ts:54-76` has no game-type check).
- The time filter knows only rolling windows and the *current* season
  (`days: number | 'all' | 'season'`, `src/shared/contract/dashboard.ts:20`); the season
  calendar (`src/core/season.ts`) already contains the verified 2026 dates (S1 Feb 10,
  S2 Apr 14, S3 Jun 16) but exposes no enumeration, past-season lookup, or labels.
- The account filter duplicates the top-left account switcher.

### Requirements
- D1. **Competitive only, everywhere.**
  - The mode filter is removed from the filter bar. All screens, stats and counts
    (incl. `totalGamesAllTime`, pending reviews, exports) consider competitive games only.
  - A **new** competitive-only gate in the match pipeline (reusing
    `src/core/matchFilter.ts` classification) stops non-competitive GEP matches from
    being recorded at all.
  - The dead `logFilter` config key and its `OW_SYNC_FILTER` env override are removed;
    an existing `logFilter` entry in user configs is ignored without error.
  - The manual quick-log loses its mode picker; manual logs are always competitive.
  - Existing non-competitive rows stay in the DB but are invisible everywhere.
  - Persisted filter state (`vantageFilters`): the `mode` key is ignored on load and
    dropped on next persist; remaining fields load normally.
- D2. **Season entries in the time filter.** Options become: `Last 7 days`, `Last 30
  days`, one entry per season that contains ≥ 1 competitive match (across all accounts —
  the list does not change with the account switcher), newest first, current season
  always listed, then `All time`.
  - Labels use the in-game year-based naming, **counter resetting each calendar year**:
    the first season starting in a year is `<year> Season 1` (so the first extrapolated
    2027 season is `2027 Season 1`, not `2027 Season 4`).
  - Work is: a new pure season-enumeration/labeling API in `src/core/season.ts`, a
    contract extension so a *specific* season is addressable (not just `'season'` =
    current), and `applyFilters` filtering to that season's `[start, end)`.
  - A persisted legacy `'season'` value maps to the current named season; a persisted
    season no longer offered in the list falls back to the default (`Last 30 days`)
    without crashing.
  - Pre-2026 seasons, if data ever exists there, are labeled by date range — no legacy
    numbering research (out of scope).
- D3. **Account filter removed.** Account selection (including "All accounts") lives
  solely in the top-left account switcher. The `account` field disappears from the filter
  bar UI but remains in filter state/IPC contract (the switcher drives it).
- D4. The role filter stays. Reset operates on the reduced set. Saved presets from the
  old shape: `mode` and `account` are stripped on load/apply (applying an old preset
  leaves the active account unchanged), and the preset is rewritten to the new shape on
  next persist.

### Acceptance criteria
- **Given** a history containing competitive and quick-play games,
  **when** any screen renders,
  **then** only competitive games are counted or listed anywhere, and no mode filter is
  visible.
- **Given** live capture running,
  **when** a quick-play match ends,
  **then** no match is written to history.
- **Given** the manual quick-log,
  **when** it opens,
  **then** there is no mode picker and a saved match is competitive.
- **Given** logged competitive matches in 2026 Season 1 and 2026 Season 3 only (today
  inside S3),
  **when** the user opens the time filter,
  **then** the options are exactly: Last 7 days, Last 30 days, 2026 Season 3, 2026
  Season 1, All time — and picking `2026 Season 1` shows only matches from Feb 10 to
  Apr 14, 2026.
- **Given** a fresh install with no matches,
  **when** the user opens the time filter,
  **then** the only season entry is the current one (2026 Season 3).
- **Given** persisted filter state from the previous version containing `mode:
  'Quick Play'` and `days: 'season'`,
  **when** the app starts,
  **then** nothing crashes, the mode key is discarded, and the time filter shows the
  current named season.
- **Given** a saved preset from the old shape containing `mode` and `account`,
  **when** the user applies it,
  **then** role/time apply, the active account selection is unchanged, and the preset is
  rewritten without the stale keys.
- **Given** the reworked filter bar,
  **when** the user looks for the account filter,
  **then** it is absent; switching accounts or choosing "All accounts" in the top-left
  switcher updates all views as before.

---

## Area E — Readiness view: drop schematic, exempt from filters, explainer popup

### Problem
The supercompensation schematic sits in the readiness trend card
(`renderer/src/views/readiness.ts:121-130`) as illustrative content. The view's data is
already computed from the *unfiltered* history (`src/core/dashboardData.ts:97-102`), but
the globally rendered filter bar (`renderer/src/app/shell.ts:210-215` — no per-view
suppression exists today) implies otherwise. There is no way to learn how the readiness
verdict is determined.

### Requirements
- E1. The supercompensation schematic is removed from the main readiness view.
- E2. The readiness view shows **no filter bar** — the shell gains a per-view
  "hide filter bar" capability (new). Readiness stays independent of *all* selection,
  including the account switcher: the player is the same person.
- E3. The verdict card gets a clickable "How is this calculated?" affordance opening a
  **modal popup** (existing `openModal` primitive) with the detailed methodology:
  verdict bands, contributing signals and their meaning, the training-load model (acute
  load vs. baseline ratio), the supercompensation model — including the schematic that
  moved out of the main view — confidence levels, and the honesty disclaimer.
- E4. The readiness trend chart and all other cards stay. When the readiness coach is
  disabled, the view keeps its existing off-state — likewise without a filter bar.

### Acceptance criteria
- **Given** the readiness view (coach enabled or disabled),
  **when** it renders,
  **then** no supercompensation schematic and no filter bar are present.
- **Given** the readiness view,
  **when** the user switches accounts or picks "All accounts" in the top-left switcher,
  **then** the verdict, signals, and trend are unchanged.
- **Given** the verdict card,
  **when** the user clicks "How is this calculated?",
  **then** a modal opens containing the methodology explanation including the
  supercompensation schematic, and closes via Escape, backdrop click, or close button.

---

## Area F — Matches list: configurable info + clean meta line

### Problem
The matches list is information-sparse and hardcodes a `role · heroes · account` meta
line (`renderer/src/views/matches.ts:108`) that renders `Damage · — · account` when no
heroes were recorded (the `—` placeholder between separators). It also shows the game
type on every row (`matches.ts:112`), which becomes constant noise once D1 makes
everything competitive.

### Requirements
- F1. **Per-field display mode.** A "Customize view" affordance on the Matches screen
  configures each of **role, heroes, account, SR delta, duration, final score**
  individually as `hidden`, `inline`, or `column`:
  - `inline` renders the field as a segment of the row's meta line;
  - `column` renders it as its own vertically aligned column across all rows — and the
    field then does **not** appear inline;
  - canonical order (both inline and columns): role · heroes · account · SR delta ·
    duration · final score.
  - Defaults: heroes, account, SR delta = `inline`; role, duration, final score =
    `hidden`. Map, W/L result, map-type pill, and game time remain always visible; the
    per-row game-type label is removed (constant under D1).
- F2. The configuration persists across sessions (renderer prefs/localStorage).
- F3. The meta line joins only segments that are `inline` **and** non-empty with `·` —
  no `—` placeholders, no leading/trailing/doubled separators. A meta line with zero
  renderable segments is omitted entirely (no empty element). An empty value in a
  `column` field renders a blank cell (alignment preserved).
- F4. SR delta renders signed and color-coded (e.g. `+25` / `−18`); duration as minutes;
  final score as recorded (e.g. `3–1`).
- F5. Contract: `MatchRow` (`src/shared/contract/dashboard.ts:41-54`) gains `srDelta` and
  `finalScore` (`toMatchRow` in `src/core/dashboardData.ts:139-154`).

### Acceptance criteria
- **Given** default settings and a match with no recorded heroes,
  **when** the matches list renders,
  **then** its meta line is e.g. `MyAccount · +25` — no `—`, no dangling separators.
- **Given** account set to `column` and role set to `inline`,
  **when** the list renders and the app is restarted,
  **then** account appears as an aligned column (and not in the meta line) and role
  appears inline — in both sessions.
- **Given** all six fields set to `hidden`,
  **when** the list renders,
  **then** rows show only the always-visible fields with no empty meta line or spacer.
- **Given** a match without SR delta while SR delta is `inline`,
  **when** the list renders,
  **then** that row simply omits the SR segment; with SR delta as `column`, the cell is
  blank but the column stays aligned.

---

## Area G — Shortcuts cheatsheet spacing

### Problem
In the `?` cheatsheet modal, content sits too close to the modal border (key badges
nearly touch it) and overall padding is uneven (`renderer/styles/components.css`
`.cheatsheet-row`, `shell.ts:400-417`).

### Requirements
- G1. Spacing pass with measurable targets: inner content padding ≥ 20px on all sides of
  the modal; group-header top spacing ≥ 2× the inter-row gap; row gaps uniform (±1px);
  key badges aligned in a fixed-width column that never touches the modal border.

### Acceptance criteria
- **Given** the cheatsheet modal open at default window size,
  **when** it renders,
  **then** the bounding box of every key badge and text is ≥ 20px from the modal border,
  group headers have at least twice the vertical space of the row gap above them, and row
  gaps are uniform.

---

## In-Scope / Out-of-Scope

**In scope:** everything under Areas A–G, including core logic changes
(`src/core/season.ts` enumeration/labeling, `src/core/dashboardData.ts`,
`src/core/matchFilter.ts` wiring, targets/review model adjustments), Notion edge
(`src/notion/`, incl. page-update capability and page-id tracking), main-process
config/storage plumbing, renderer views and a per-view filter-bar suppression in the
shell, IPC-contract updates (filter shape, season addressing, `MatchRow.srDelta`/
`finalScore`), unit tests for all changed core logic, README updates, **updating the
affected existing specs** (`notion-import.spec.md`, `screen-matches.spec.md`,
`dashboard-filter-fixes.spec.md`, `sqlite-storage-notion-sync.spec.md`,
`supercompensation-detection.spec.md`, `screen-shell.spec.md`), and creating the grouped
GitHub issues.

**Out of scope:**
- NSIS/installer custom pages (data folder is chosen in-app).
- Automatic (non-user-triggered) Notion traffic; two-way live sync beyond the described
  update-on-sync and import-merge.
- Deleting non-competitive rows from the DB (they are only hidden).
- Fetching the season calendar from the network at runtime (bundled calendar only).
- Pre-2026 season labels beyond date-range fallback.
- Localization, non-Windows packaging.

## Constraints

- All five CLAUDE.md guardrails hold; notably `src/core/` stays pure (season
  enumeration, filtering, aggregate-grade rule, import-merge decisions live there with
  vitest tests), the renderer stays CSP-friendly, and **outbound Notion traffic only on
  explicit user action** (updates ride the manual sync).
- The IPC contract stays typed end-to-end; all shape changes go through
  `src/shared/contract/`.
- Data migration (Area C) is loss-proof: copy-verify-then-delete, never overwrite
  existing Vantage data, adopt-don't-migrate for folders that already contain data.
- Import never overwrites locally recorded reviews or mental records (local wins).
- Backwards compatibility: old persisted filter state, old presets, and configs still
  containing `logFilter` load without error.

### Definition-of-Done additions (process, not product ACs)
- Area A ships with a regression test reproducing the create-only/empty-columns behavior
  before the fix (exporter-level, simulated Gametracker schema).
- Area G is verified with before/after screenshots from the browser preview harness.

## Resolved Questions

1. **User's `Improvement Target` column content?** Proper grades (`hit`/`partially`/
   `missed` select) — parsing is fine; the causes are create-only export, the internal-id
   slot never being fed by in-app reviews, and import skipping existing rows.
2. **`Comms` export symptom?** Cells stay empty despite the flag → covered by the same
   create-only/update-on-sync fix + per-column diagnostics (A2/A3).
3. **Recording imported grades?** Hidden bookkeeping — review under the internal id, no
   visible target anywhere (B2); migration removes the previously seeded synthetic
   target (B3).
4. **Multi-target reviews → one Notion cell?** Aggregate rule: all hit → `hit`, all
   missed → `missed`, otherwise `partially` (A1).
5. **Data folder choice?** First-run step + Settings with full migration; no installer
   page (C). Folders already containing Vantage data are adopted (first run) or
   adopt-or-cancel (Settings) — never overwritten. *(Adoption behavior decided during
   spec review — flag at approval if you disagree.)*
6. **Non-competitive games?** Track competitive only: new capture gate, `logFilter`
   config + manual mode picker removed, existing non-comp rows hidden (D1).
7. **Season naming?** In-game year-based naming, counter resets each calendar year
   (`2026 Season N`; first 2027 season = `2027 Season 1`). Only seasons with data are
   listed (current always; fresh installs see just the current season). Verified 2026
   dates: S1 Feb 10, S2 Apr 14, S3 Jun 16 — already in `src/core/season.ts` (D2).
8. **Default match-row info?** Heroes, account, SR delta visible by default (inline);
   role and others available but hidden (F1).
9. **Matches "as column"?** Each field is individually configurable as hidden, inline
   text, or its own aligned column; a column field leaves the inline text (F1).
10. **Readiness explainer entry?** "How is this calculated?" link on the verdict card
    opening a modal (E3).
11. **Shortcuts screen issue?** Content/key badges too close to the modal border +
    uneven padding → measurable spacing targets (G1).
12. **"All accounts" affordance?** The existing switcher popover entry suffices (D3).
13. **Season list scope?** Derived from competitive matches across all accounts — the
    option list does not change with the account switcher. *(Decided during spec review.)*
14. **When do review changes reach Notion?** On the next manual sync — no automatic
    outbound traffic (A2). *(Decided during spec review; follows guardrail 5.)*

## Open Questions

- **A (mechanism):** matchId→pageId map in local storage vs. querying Notion by the
  `Match ID` column at update time — techplan decision (affects the outbox/store schema).
- **C (config key):** reuse/rename `historyDbFolder` for the all-files data folder —
  techplan decision.
- **D (future seasons):** Blizzard may drift from the 63-day cadence; the bundled
  calendar is updated with app releases. Accepted risk — an extrapolated future season
  may be temporarily mislabeled until an app update.

## GitHub issues to create after approval (grouped by category)

1. `notion-sync` — Export: update-on-sync for reviewed matches, aggregate grade rule,
   per-column diagnostics (Area A).
2. `notion-sync` — Import: merge grades into existing matches, hidden bookkeeping review,
   remove visible synthetic target (Area B).
3. `onboarding/storage` — Choose data folder at first run + full-data migration/adoption
   in Settings (Area C).
4. `filters` — Competitive-only capture & UI, named season entries, remove account
   filter (Area D).
5. `readiness` — Remove supercompensation schematic, hide filter bar, methodology
   popup (Area E).
6. `matches` — Per-field configurable row info (hidden/inline/column) + meta-line
   fix (Area F).
7. `ui-polish` — Shortcuts cheatsheet spacing pass (Area G).
