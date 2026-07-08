---
slug: editable-master-data
status: done
updated: 2026-07-06
---

# Spec: Editable & Updatable Master Data

**Slug:** `editable-master-data` · **Status:** Approved

## Intent (WHAT & WHY)

Overwatch's master data — the roster of **heroes** (and roles), the list of **maps**
(and game modes), and the **competitive seasons** — changes every few weeks. Today all
three are hard-coded tables in `src/core/` (`heroes.ts`, `maps.ts`, `season.ts`), imported
directly by both the main-process core (analytics, sample data, resolvers) *and* the
renderer (quick-log typeahead, filters, match detail). When Blizzard adds a hero/map or
starts a season, Vantage is **stale until we ship an update**: the new hero is missing from
the typeahead, the new map shows `Unknown` mode, "This season" can drift.

Goal — the user **never waits for a Vantage release** to stay current:

1. **Editable** — add, edit, and remove heroes, maps, and seasons; edits survive app updates.
2. **Updatable** — one **"Update"** action fetches the latest heroes & maps from an online
   source derived from official Blizzard data, diffs it against what Vantage knows, and shows
   **new + changed** entries as a **non-destructive preview** the user **accepts or discards**
   per item.
3. **Still editable after** — accepting a fetched change never locks it; every entry stays
   editable.

Benefit: the product stays correct between releases, without weakening account safety (this
is catalog data, not match/account data) and without a forced automatic overwrite.

## In-Scope

- **Master Data editor** in the existing Settings screen (`renderer/src/views/settings.ts`),
  with Heroes / Maps / Seasons sections supporting add / edit / remove on the fields Vantage
  uses:
  - **Hero:** name, role (`tank`/`damage`/`support`).
  - **Map:** name, game mode (`Push`/`Hybrid`/`Escort`/`Control`/`Flashpoint`/`Clash`), and
    **`isActive`** (in the current competitive map pool).
  - **Season:** start date/instant, label.
- **Effective-data layer:** bundled defaults ⊕ machine-local user overrides
  (adds/edits/removes), **replacing the direct static-table imports** so one source of truth
  feeds both main-core and renderer consumers.
- **Per-map `isActive` flag (competitive map pool):** optional boolean in the override layer;
  missing/`undefined` ⇒ `true` (no migration for pre-feature configs). Defaults `true` for
  built-ins, user-added, and Update-added maps. It gates **new-match affordances only** —
  quick-log browse suggestions, match-detail dropdown options, and the sample-data generator
  pool. Everything reading history (`mapMode()` resolution, `byMap`/`byMapType`/`focusMaps`,
  overview scatter, mode filters, match-detail `mapType`) **ignores `isActive`**.
- **Single "Update" action** — one button, one combined fetch, one merged preview for heroes
  **and** maps (Resolved Q5). Runs in the main process (renderer is CSP-locked), fetches from
  the **OverFast API** (community, MIT, scrapes official Blizzard pages: `/heroes` →
  `key,name,role`; `/maps` → `name,gamemodes`), diffs vs current effective data, returns
  **additions + changes** (Resolved Q2).
- **Internal mode-mapping table** (Resolved Q6): a Vantage-owned lookup translating OverFast
  game-mode strings (`push`, `flashpoint`, …) → Vantage's `MapMode` union; anything unmapped
  falls to `Unknown` and is surfaced for the user to set.
- **Preview → accept/discard** review UI: nothing persists until accept; accept is per-item;
  discard leaves data untouched.
- **Bundled data snapshot** shipped with the app (Resolved Q3) so the baseline is sensible and
  the feature **degrades gracefully offline**. At release the snapshot marks known-withheld
  maps (Paris, Horizon Lunar Colony, and any current bug-disabled map) `isActive:false`
  (Resolved Q8).
- **Untrusted-input handling:** the fetched payload is validated/normalized before it can enter
  the preview; malformed/unexpected responses are rejected with a clear message, never stored.
- **Update-safety:** overrides keyed by stable identity (hero name; normalized map name via
  existing `normalizeMapName`; season start-ISO `S:<iso>`) and **de-duplicated against future
  bundled defaults**, so a hand-added entry later shipped as a built-in doesn't double up and
  edits aren't lost across updates.

## Out-of-Scope

- **Fetching seasons.** No API exposes Overwatch season start-dates. Seasons stay **manually
  editable**, and the existing 9-week auto-cadence extrapolation in `season.ts` is **kept** so
  "This season" keeps advancing if the user doesn't add the new one. (Resolved Q1.)
- **Fetching `isActive`.** No official or community source exposes competitive-pool status as
  structured data — it lives only in prose patch notes/dev blogs. Update **never** reads,
  derives, or writes `isActive`; it stays a manual, local-only toggle. (Resolved Q7.)
- **`isActive` on heroes.** The flag is **maps-only** — heroes are governed by role lock, not a
  withheld pool. No hero pool flag; no automatic pool detection, reminder, or cadence.
- **Retroactively rewriting history.** Master-data edits (role/mode changes, removals,
  deactivations) affect **new logging and suggestions only** — already-logged matches keep the
  values they were recorded with (Resolved Q4).
- **Inactive visual treatment is editor-only** (Resolved Q10): the muted style appears only in
  the master-data settings editor; the matches overview/analytics show inactive maps' history
  like any other map (no badge). No Notion Maps-DB schema change — `isActive` is not mirrored as
  a Notion "Active" property (Resolved Q9).
- Automatic/background/scheduled updates (Update is user-initiated only).
- Editing data Vantage doesn't consume (abilities, portraits/art, lore, screenshots, sub-roles,
  ranks).
- Syncing edits across machines; a general plugin/rules engine.

## Constraints

- **Guardrail 1 (account safety):** unaffected — public catalog data, no game memory/injection.
- **Guardrail 3 (core pure & Electron-free):** all network I/O at the **edge** (`src/main/`),
  never in `src/core/`. Core owns the **pure** diff/merge/validation/mode-mapping logic
  (unit-tested), no Electron/HTTP imports.
- **Guardrail 4 (renderer CSP-friendly):** renderer never fetches remote; the fetch happens in
  main and crosses the typed IPC contract; no inline scripts/`eval`/runtime remote code.
- **Guardrail 5 (local-first, opt-in):** introduces a **second outbound path** besides Notion.
  It must be **inbound reference data only**, **user-initiated**, sending **no
  personal/account/match/Notion data**. This is an intentional, acknowledged expansion —
  reflected in docs.
- **Source reality:** no official Blizzard JSON API; OverFast is the chosen source (untrusted,
  may move/go down) → configurable endpoint + bundled snapshot fallback.
- **IPC stays typed end-to-end** (no `any`); new master-data + update contracts go through
  `src/shared/contract`.
- **Definition of Done:** `npm test` green; `npm run typecheck` clean (main + renderer); new
  pure `core/` logic ships with vitest tests; README/docs updated for the Update action and the
  new outbound path.
- **Grounding / sources:** [OverFast API](https://overfast-api.tekrop.fr/) &
  [its OpenAPI schema](https://github.com/TeKrop/overfast-api) (MIT; `/maps` = name+gamemodes
  only, no pool field), [ow-api.com](https://ow-api.com/) (player-stats only),
  [Blizzard forums "Overwatch API"](https://us.forums.blizzard.com/en/blizzard/t/overwatch-2-api/19214)
  (no official API), and Blizzard's April 2025 "Refining Hero Pools and Retiring Map Pools"
  update (pool rotation retired).

## Acceptance Criteria *(Given / When / Then)*

**Editing**
1. **Given** the editor, **when** the user adds a hero (name + role), **then** it appears in the
   quick-log typeahead, is grouped under that role everywhere, and persists across restart.
2. **Given** a map, **when** the user edits its game mode, **then** by-mode grouping and
   match-detail tags reflect the new mode and `Unknown` no longer appears for it.
3. **Given** any entry, **when** the user removes it, **then** it leaves typeaheads/filters,
   **but** already-logged matches referencing it still display and aggregate (removal affects
   suggestions, not history).
4. **Given** a hero/map GEP reports that isn't in the list, **when** a match is ingested,
   **then** it's stored and shown exactly as today (the list assists input, never gates it).

**Update — fetch & preview**
5. **Given** the user clicks **Update** (single combined fetch), **when** the OverFast fetch
   succeeds, **then** one preview lists **additions** (heroes/maps not known) and **changes**
   (differing role/mode), showing current-vs-proposed for changes; nothing is persisted yet.
6. **Given** the preview, **when** the user discards it (or an item), **then** effective data is
   unchanged for the discarded items.
7. **Given** the preview, **when** the user accepts an item, **then** it merges into effective
   data, persists, and remains fully editable.
8. **Given** the user has manually edited an entry, **when** Update proposes a different value,
   **then** it's surfaced as a per-item **change** — the user's edit is never silently
   overwritten.
9. **Given** nothing new or changed, **when** the preview is computed, **then** the user is told
   they're already up to date (empty preview).
10. **Given** an OverFast game-mode string with no mapping, **when** a fetched map is previewed,
    **then** its mode is `Unknown` and surfaced for the user to set (never guessed).

**History immutability (Resolved Q4)**
11. **Given** the user accepts a hero **role change** (e.g. Doomfist DPS→Tank), **when**
    applied, **then** new logs offer only the new role, **and** previously-logged Doomfist
    matches keep their originally-recorded role in all analytics (history is never rewritten).
12. **Given** a hero is effectively **renamed** upstream, **when** the change is accepted,
    **then** the new name is added and the old name is **kept as an orphan entry** so historical
    records referencing it still resolve; the user may remove the orphan manually.

**Resilience & trust**
13. **Given** the API is unreachable/times out, **when** the user clicks Update, **then** the
    app reports it clearly, falls back to the bundled snapshot baseline, and never crashes or
    corrupts data.
14. **Given** a malformed/unexpected response, **when** parsed, **then** it's rejected
    (validated first); no partial/malformed entry enters preview or storage.
15. **Given** an Update request, **when** sent, **then** it contains **no**
    personal/account/match/Notion data.

**Update-safety across releases**
16. **Given** a hand-added hero that a later Vantage version ships as a built-in, **when** the
    new version loads, **then** it appears **once** (deduped by identity), edits preserved.
17. **Given** any user overrides, **when** the app updates to changed bundled defaults, **then**
    user adds/edits/removes still apply on top (no reset, no loss).

**Seasons (manual + auto-cadence)**
18. **Given** Update, **when** it runs, **then** it does **not** fetch or modify seasons.
19. **Given** no manual season for the current period, **when** the boundary passes, **then**
    the existing auto-cadence still advances "This season."
20. **Given** the user adds/edits a season (start + label), **then** season filter options and
    the "This season" boundary use the edited value.

**Per-map `isActive` (competitive pool)**
21. **Given** a map toggled inactive, **when** the user browses the quick-log map typeahead (no
    query), **then** the inactive map isn't suggested (in log-match it is simply not shown).
22. **Given** a map toggled inactive, **when** the user types its exact name, **then** the name
    still resolves/accepts (resolution isn't gated by `isActive`) so a match can be logged on it.
23. **Given** a historical match on a now-inactive map, **when** the dashboard aggregates,
    **then** it still appears in `byMap`, groups under its correct mode in `byMapType` (not
    `Unknown`), and its recent-row `mapType` is correct.
24. **Given** the sample-data generator runs, **when** it selects maps, **then** it picks only
    `isActive:true` maps, falling back to the full set only if zero are active.
25. **Given** the match-detail map dropdown for a match on an inactive map, **when** the edit
    view renders, **then** that inactive map is present and selected, while other inactive maps
    are excluded from options.
26. **Given** a map toggled inactive (not removed), **when** the user views
    analytics/filters/match-detail, **then** no logged data for it is hidden or erased — only
    suggestions and sample generation exclude it.
27. **Given** a user-toggled-inactive map, **when** Update runs and OverFast reports it
    unchanged in name/mode, **then** Update doesn't list it as a change and doesn't alter
    `isActive`.
28. **Given** a user-toggled-inactive map and a legitimate mode change from Update, **when** the
    user accepts it, **then** the mode updates but `isActive:false` is preserved.
29. **Given** Update introduces a brand-new map, **when** accepted, **then** it's added
    `isActive:true`.
30. **Given** map overrides persisted before this feature (no `isActive`), **when** loaded,
    **then** each is treated active with no migration.

**Release curation, export & visibility**
31. **Given** a fresh install on the bundled snapshot, **when** it loads, **then** maps
    known-withheld at release (Paris, Horizon Lunar Colony, current bug-disabled maps) are
    `isActive:false` and all others `isActive:true`.
32. **Given** Notion export, **when** the Maps DB is populated, **then** **all** maps (active +
    inactive) get a page; `isActive` is not written as a Notion property
    (`src/notion/notionAdmin.ts` keeps iterating the full map set).
33. **Given** the master-data editor, **when** an inactive map is listed, **then** it renders
    with **muted styling**; **and** inactive maps get no badge or special treatment anywhere in
    the matches overview/analytics.

**Non-negotiables**
34. `npm test` passes; `npm run typecheck` clean (main + renderer); new pure
    diff/merge/validation/mode-mapping logic in `core/` has vitest coverage; README/docs note
    the Update action and the new outbound path.

## Update-interaction note (`isActive`)

Update is **idempotent w.r.t. `isActive`**. OverFast `/maps` returns only `name`+`gamemodes`;
no source exposes pool status. So: (1) new maps arrive as additions with default
`isActive:true`; (2) the change-diff for an existing map is computed **only over API fields**
(name, mode) — `isActive` is excluded, so a map whose only local difference is its flag is never
surfaced as a change and Update never proposes reverting the toggle; (3) accepting a mode change
applies API fields on top of the stored record and **preserves the existing `isActive`**;
(4) the snapshot fallback may seed defaults for never-seen maps but never clobbers an existing
override's `isActive`.

## Resolved questions

- **Q1 — Seasons (no API):** Manual + keep auto-cadence. Update fetches heroes & maps only.
- **Q2 — Update preview scope:** Additions **and** changes; user decides per item; edits never
  silently overwritten.
- **Q3 — Source & dependency:** OverFast API + bundled snapshot fallback; fetch on demand,
  untrusted, configurable endpoint.
- **Q4 — Hero rework/rename:** Changes apply to new logging only; history is immutable (Doomfist
  stays DPS for old matches, Tank for new); renames keep the old name as an orphan entry.
- **Q5 — Update surface:** One Update button, single combined fetch/preview for heroes + maps.
- **Q6 — Mode vocabulary:** Internal Vantage-owned mapping table (OverFast strings → `MapMode`);
  unmapped ⇒ `Unknown`, surfaced for the user.
- **Q7 — `isActive` fetch-vs-manual:** Manual, local-only toggle, never wired into Update — no
  API exposes pool status and rotation was retired April 2025.
- **Q8 — Release-time pool curation:** Ship the bundled snapshot with known-withheld maps
  (Paris, Horizon Lunar Colony, current bug-disabled maps) as `isActive:false`.
- **Q9 — Notion export policy:** Export **all** maps; no Notion "Active" property mirrored.
- **Q10 — Inactive visibility:** Muted style only in the master-data editor; matches
  overview/analytics show inactive-map history normally; log-match omits inactive maps.

## Open Questions

None — all resolved.
