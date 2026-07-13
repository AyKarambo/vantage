# Screen spec: Maps (`maps`)

**Source:** `renderer/src/views/maps.ts`, `renderer/src/components/chartCard.ts`, `renderer/src/charts/tooltip.ts`, `src/core/maps.ts`.

**Shared context:** Renders from a `DashboardData` snapshot via `ViewContext`; the global filter bar re-scopes everything shown. Accepts a `highlight` param (`ViewParams.highlight`) — the entry point for the command palette's Map results and the map cross-links on Matches rows (see `screen-shell.spec.md`, `screen-matches.spec.md`).

## Intent

"Where the games actually go" — performance by game mode, play-share per map, and every map ranked best → worst, so the player sees which modes and maps carry or drain their results.

## Layout & behaviour

- **One card per game mode** (`byMapType`): mode name, winrate (colour-coded), games count, signed net, winrate stat bar.
- **Maps played donut:** share of games per map — the top 10 maps by games individually, the remainder rolled into one "Other (n maps)" slice. Slices carry a hover tooltip (label · games · share).
- **Winrate by map** horizontal bars: best → worst, restricted to maps with ≥3 games. The card is a `chartCard` with a **Chart/Table** toggle in the header — the table renders the same data as text (columns Map · WR · Net · Games, sortable) for accessibility and copy-friendly numbers.
- **Chart tooltips:** the winrate bars use the shared cursor-following tooltip layer (with a native `<title>` fallback), the same pattern the scatter and donut use.
- **Highlight entry:** navigated to with `{ highlight: <map> }`, the view scrolls that map's bar into view (centered) and flashes it (`is-highlighted`, ~2.4s) — the landing behavior for palette Map results and Matches-row map cross-links.

## Out-of-Scope

- Per-map drill-down or navigation.
- Mode-level trends over time (owned by `screen-trends.spec.md`).

## Constraints & edge cases

- `MIN_MAP_GAMES = 3` — the ranking only includes maps with at least 3 games in range; if **no** map reaches 3, the ranking falls back to showing all maps rather than rendering empty.
- `TOP_SLICES = 10` — the donut shows at most 10 named slices plus "Other".
- Charts are dependency-free SVG; the tooltip layer and the table toggle are hand-rolled (guardrail #4).
- A `highlight` for a map not present in the current range simply doesn't flash anything — no error, no filter change.
- Map names are canonical (`src/core/maps.ts`); legacy raw GEP ids and older misspellings (e.g. the numeric `4140` that stands in for **Neon Junction**) normalize to their canonical name on load, so a map is never double-listed.
