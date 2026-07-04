# Screen spec: Maps (`maps`)

**Source:** `renderer/src/views/maps.ts` · reverse-engineered 2026-07-04
**Provenance tags:** [explicit] stated in code/comments · [inferred] reconstructed from behavior

**Shared context:** Renders from a `DashboardData` snapshot via `ViewContext`; the global filter bar re-scopes everything shown.

## Intent (WHAT & WHY)

[explicit] "Where the games actually go" — performance by game mode, play-share per map, and every map ranked best → worst, so the player sees which modes and maps carry or drain their results.

## In-Scope

- One card per game mode (`byMapType`): mode name, winrate (colour-coded), games count, signed net, winrate stat bar.
- **Maps played** donut: share of games per map — top 10 maps by games individually, the remainder rolled into one "Other (n maps)" slice.
- **Winrate by map** horizontal bars: best → worst, restricted to maps with ≥3 games.

## Out-of-Scope

- Per-map drill-down or navigation.
- Mode-level trends over time (owned by `screen-trends.spec.md`).

## Constraints

- [explicit] `MIN_MAP_GAMES = 3` — the ranking only includes maps with at least 3 games in range.
- [explicit] Fallback: if **no** map reaches 3 games, the ranking shows all maps rather than rendering empty.
- [explicit] `TOP_SLICES = 10` — donut shows at most 10 named slices plus "Other".
- Charts are dependency-free SVG (project convention).

## Acceptance Criteria (current behavior)

- Given maps with ≥3 games in range, when the "Winrate by map" card renders, then only those maps appear, sorted by winrate descending.
- Given no map has 3 games, then all maps in range are ranked instead.
- Given more than 10 maps in range, then the donut shows the 10 most-played maps individually plus one aggregated "Other (n maps)" slice; given ≤10, no "Other" slice appears.
- Given game modes in range, then each mode card shows winrate, games, and signed net with a winrate bar.

## Known gaps (intent ≠ code)

None identified — behavior matches intent.

## Open Questions

None.
