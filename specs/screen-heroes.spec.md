# Screen spec: Heroes (`heroes`)

**Source:** `renderer/src/views/heroes.ts`, `renderer/src/components/table.ts`, `renderer/src/prefs.ts` · reverse-engineered 2026-07-04 · updated 2026-07-04 after the ui-qol batch (PR #8)
**Provenance tags:** [explicit] stated in code/comments · [inferred] reconstructed from behavior · [qol 2026-07-04] shipped in the ui-qol batch (intent: `ui-qol.spec.md`)

**Shared context:** Renders from a `DashboardData` snapshot via `ViewContext`; the global filter bar re-scopes both the table and the drawer. The drill-down drawer is also reachable from outside this screen: the command palette's Hero entries and the hero cross-links on Matches rows call the exported `openHeroDrawer` (see `screen-shell.spec.md`, `screen-matches.spec.md`).

## Intent (WHAT & WHY)

[explicit] The exact-numbers screen: per-hero performance normalized **per 10 minutes**, with a click-through drawer for depth on a single hero. Complements the coaching screens (Focus/Targets) with raw comparable stats.

## In-Scope

- Sortable data table, one row per hero: Hero, Role (tag), Games, WR (colour-coded), KDA, and per-10 columns E/10, D/10, A/10, DMG/10, HEAL/10, MIT/10. Default sort: games descending.
- [qol 2026-07-04] **Sort persistence:** the chosen sort column + direction persists as the `heroSort` pref — it survives re-renders, filter changes, *and* app relaunches. A persisted sort is only honored if its column still exists; otherwise the default (games descending) applies.
- [qol 2026-07-04] **Sticky header:** the table header row stays pinned while the table body scrolls (the table wrap is its own scroll container).
- [qol 2026-07-04] **Min-games chips:** a "min. games" chip row (1+ · 5+ · 10+) in the view header hides heroes with fewer games; the choice persists (`minGames` pref, default 1+ = show all). When rows are hidden, the subtitle appends "· N low-sample hidden".
- Row click opens a drill-down drawer: hero name, overall line (games · winrate · W/L), per-10 stat grid (KDA, Elims, Deaths, Dmg, Heal, Mit), **By map** winrate list, **Recent** games list (result pill, map, account, date).

## Out-of-Scope

- Editing anything; hero comparison side-by-side; hero-specific ability stats (those belong to the planned match detail page, `screen-matches.spec.md`).

## Constraints

- [explicit] The drawer detail is fetched asynchronously via the bridge (`heroDetail(hero, filters)`) **with the current global filters**, so the drill-down always matches the table's scope; it shows "Loading…" until resolved.
- [explicit] Missing per-10 stats render as formatted-null (dash), not zero — absence of data is distinguishable from zero.
- [qol 2026-07-04] Sort and min-games preferences go through the typed `prefs` localStorage facade (same mechanism as the filters — `ui-qol.spec.md` constraint); storage failures degrade to the defaults.

## Acceptance Criteria (current behavior)

- Given hero stats in range, when Heroes renders, then the table sorts by games descending and clicking any column header re-sorts by that column (second click flips direction).
- Given I sorted by WR and relaunch the app, when Heroes renders, then the table is still sorted by WR in the same direction.
- Given I select the "5+" chip, then heroes with fewer than 5 games disappear from the table, the subtitle notes how many low-sample rows are hidden, and the choice survives a relaunch.
- Given a table taller than the viewport, when I scroll the table, then the header row stays visible.
- Given a row click (or a palette Hero entry, or a hero cross-link on a Matches row), then a drawer opens showing "Loading…" and fills with that hero's detail scoped to the active filters (overall line, stat grid, by-map winrates, recent games).
- Given a hero with no per-10 stats, then those cells/boxes render as dashes and the stat grid is omitted in the drawer when stats are absent.

## Known gaps (intent ≠ code)

None identified — behavior matches intent.

## Open Questions

None.
