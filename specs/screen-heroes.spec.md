# Screen spec: Heroes (`heroes`)

**Source:** `renderer/src/views/heroes.ts` · reverse-engineered 2026-07-04
**Provenance tags:** [explicit] stated in code/comments · [inferred] reconstructed from behavior

**Shared context:** Renders from a `DashboardData` snapshot via `ViewContext`; the global filter bar re-scopes both the table and the drawer.

## Intent (WHAT & WHY)

[explicit] The exact-numbers screen: per-hero performance normalized **per 10 minutes**, with a click-through drawer for depth on a single hero. Complements the coaching screens (Focus/Targets) with raw comparable stats.

## In-Scope

- Sortable data table, one row per hero: Hero, Role (tag), Games, WR (colour-coded), KDA, and per-10 columns E/10, D/10, A/10, DMG/10, HEAL/10, MIT/10. Default sort: games descending.
- Row click opens a drill-down drawer: hero name, overall line (games · winrate · W/L), per-10 stat grid (KDA, Elims, Deaths, Dmg, Heal, Mit), **By map** winrate list, **Recent** games list (result pill, map, account, date).

## Out-of-Scope

- Editing anything; hero comparison side-by-side; hero-specific ability stats (those belong to the planned match detail page, `screen-matches.spec.md`).

## Constraints

- [explicit] The drawer detail is fetched asynchronously via the bridge (`heroDetail(hero, filters)`) **with the current global filters**, so the drill-down always matches the table's scope; it shows "Loading…" until resolved.
- [explicit] Missing per-10 stats render as formatted-null (dash), not zero — absence of data is distinguishable from zero.

## Acceptance Criteria (current behavior)

- Given hero stats in range, when Heroes renders, then the table sorts by games descending and clicking any column header re-sorts by that column.
- Given a row click, then a drawer opens showing "Loading…" and fills with that hero's detail scoped to the active filters (overall line, stat grid, by-map winrates, recent games).
- Given a hero with no per-10 stats, then those cells/boxes render as dashes and the stat grid is omitted in the drawer when stats are absent.

## Known gaps (intent ≠ code)

None identified — behavior matches intent.

## Open Questions

None.
