# Screen spec: Maps (`maps`)

**Source:** `renderer/src/views/maps.ts`, `renderer/src/components/chartCard.ts`, `renderer/src/charts/tooltip.ts` · reverse-engineered 2026-07-04 · updated 2026-07-04 after the ui-qol batch (PR #8)
**Provenance tags:** [explicit] stated in code/comments · [inferred] reconstructed from behavior · [qol 2026-07-04] shipped in the ui-qol batch (intent: `ui-qol.spec.md`)

**Shared context:** Renders from a `DashboardData` snapshot via `ViewContext`; the global filter bar re-scopes everything shown. This view accepts a `highlight` param (`ViewParams.highlight`) — the entry point for the command palette's Map results and the map cross-links on Matches rows (see `screen-shell.spec.md`, `screen-matches.spec.md`).

## Intent (WHAT & WHY)

[explicit] "Where the games actually go" — performance by game mode, play-share per map, and every map ranked best → worst, so the player sees which modes and maps carry or drain their results.

## In-Scope

- One card per game mode (`byMapType`): mode name, winrate (colour-coded), games count, signed net, winrate stat bar.
- **Maps played** donut: share of games per map — top 10 maps by games individually, the remainder rolled into one "Other (n maps)" slice. Slices carry a hover tooltip (label · games · share).
- **Winrate by map** horizontal bars: best → worst, restricted to maps with ≥3 games.
- [qol 2026-07-04] **View as table:** the "Winrate by map" card is a `chartCard` with a Chart/Table toggle in the card header — the table renders the same data as text (columns Map · WR · Net · Games, sortable) for accessibility and copy-friendly numbers.
- [qol 2026-07-04] **Chart tooltips:** the winrate bars use the shared cursor-following tooltip layer (with a native `<title>` fallback), the same pattern the scatter and donut established.
- [qol 2026-07-04] **Highlight entry:** when navigated to with `{ highlight: <map> }`, the view scrolls that map's bar into view (centered) and flashes it (`is-highlighted`, ~2.4s) — the landing behavior for palette Map results and Matches-row map cross-links.

## Out-of-Scope

- Per-map drill-down or navigation.
- Mode-level trends over time (owned by `screen-trends.spec.md`).

## Constraints

- [explicit] `MIN_MAP_GAMES = 3` — the ranking only includes maps with at least 3 games in range.
- [explicit] Fallback: if **no** map reaches 3 games, the ranking shows all maps rather than rendering empty.
- [explicit] `TOP_SLICES = 10` — donut shows at most 10 named slices plus "Other".
- Charts are dependency-free SVG (project convention); [qol 2026-07-04] the tooltip layer and the chart-card table toggle are hand-rolled components, no new dependencies (guardrail #4).
- [qol 2026-07-04] A `highlight` for a map not present in the current range (filtered out / below the 3-game cutoff when other maps qualify) simply doesn't flash anything — no error, no filter change.

## Acceptance Criteria (current behavior)

- Given maps with ≥3 games in range, when the "Winrate by map" card renders, then only those maps appear, sorted by winrate descending.
- Given no map has 3 games, then all maps in range are ranked instead.
- Given more than 10 maps in range, then the donut shows the 10 most-played maps individually plus one aggregated "Other (n maps)" slice; given ≤10, no "Other" slice appears.
- Given game modes in range, then each mode card shows winrate, games, and signed net with a winrate bar.
- Given the "Winrate by map" card, when I click the Table toggle, then the same ranked data renders as a text table (Map · WR · Net · Games); clicking Chart restores the bars.
- Given a hover over a winrate bar or a donut slice, then a tooltip shows that entry's details.
- Given navigation here with `{ highlight: "Numbani" }` and Numbani is in the ranking, then its bar scrolls into view and flashes for a couple of seconds.

## Known gaps (intent ≠ code)

None identified — behavior matches intent.

## Open Questions

None.
