# Screen spec: Heroes (`heroes`)

**Source:** `renderer/src/views/heroes.ts`, `renderer/src/components/table.ts`, `renderer/src/components/roleIcon.ts`, `renderer/src/prefs.ts`.

**Shared context:** Renders from a `DashboardData` snapshot via `ViewContext`; the global filter bar re-scopes both the table and the drawer. The drill-down drawer is also reachable from outside this screen: the command palette's Hero entries and the hero cross-links on Matches rows call the exported `openHeroDrawer` (see `screen-shell.spec.md`, `screen-matches.spec.md`).

## Intent

The exact-numbers screen: per-hero performance normalized **per 10 minutes**, with a click-through drawer for depth on a single hero. Complements the coaching screens (Focus/Targets) with raw comparable stats.

## Layout & behaviour

- **Sortable data table,** one row per hero: Hero, **Role** (a **role icon** via the shared `roleIcon` component), Games, WR (colour-coded), KDA, and per-10 columns E/10, D/10, A/10, DMG/10, HEAL/10, MIT/10. Default sort: games descending. Sorting by the Role column sorts by role (the icon carries an accessible label).
- **One row per hero — hero-swap duplicates merge.** When a match had the player swap onto the same hero more than once, those segments aggregate into a single hero row (one game counted per hero, stats summed), so a hero is never double-listed for one match.
- **Per-10 minute source:** per-10 rates prefer the hero's **real on-hero minutes** within each match when known; when a match's per-hero playtime isn't recorded, its duration is split equally across the heroes played.
- **Sort persistence:** the chosen sort column + direction persists as the `heroSort` pref — surviving re-renders, filter changes, and relaunches. A persisted sort is honoured only if its column still exists; otherwise the default (games descending) applies.
- **Sticky header:** the header row stays pinned while the table body scrolls (the table wrap is its own scroll container).
- **Min-games chips:** a "min. games" chip row (1+ · 5+ · 10+) hides heroes with fewer games; the choice persists (`minGames` pref, default 1+). When rows are hidden, the subtitle appends "· N low-sample hidden".
- **Row click** opens a drill-down drawer: hero name, overall line (games · winrate · W/L), per-10 stat grid (KDA, Elims, Deaths, Dmg, Heal, Mit), **By map** winrate list, **Recent** games list (result pill, map, account, date).

## Out-of-Scope

- Editing anything; hero comparison side-by-side; hero-specific ability stats.

## Constraints & edge cases

- The drawer detail is fetched asynchronously via the bridge (`heroDetail(hero, filters)`) **with the current global filters**, so the drill-down always matches the table's scope; it shows "Loading…" until resolved.
- Missing per-10 stats render as formatted-null (dash), not zero — absence is distinguishable from zero; the stat grid is omitted in the drawer when stats are absent.
- Sort and min-games preferences go through the typed `prefs` localStorage facade; storage failures degrade to the defaults.
