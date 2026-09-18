# Screen spec: Focus (`focus`)

**Source:** `renderer/src/views/focus.ts` (`targetButton`, `openTrackPopover`), `src/core/analytics/focus.ts` (`linkFocusTargets`, `linkedTarget`, `scopeLinksEntry`), `src/core/masterData/resolver.ts` (`makeMapActive`), `renderer/src/components/popover.ts` (`openPopover`).
**Provenance tags:** [explicit] stated in code/comments · [inferred] reconstructed from behavior · [confirmed] user decision

**Shared context:** Renders from a `DashboardData` snapshot via `ViewContext`; the global filter bar re-scopes the list. Sits in the app's focus hierarchy: **Overview teases** (single "Top priority" callout) → **Focus prioritizes** (this screen, the hub) → **Maps/Trends** stay the raw reference tables → **Targets** is the commitment.

## Intent (WHAT & WHY)

[explicit] The "work on these" hub — the **maps, heroes and roles** (H1) where the player both loses a lot and plays a lot, ranked within each dimension by a sample-aware deficit score, because those cost the most rank. Each entry closes the loop: a trend verdict shows whether it is getting better or worse, and an entry already tracked by an improvement target shows the winrate movement since it was flagged.

## In-Scope

- **Three sections — Roles, Heroes, Maps** (H1), each rendered from `DashboardData.focusItems` (`focusEntries` + `linkFocusTargets`, `src/core/analytics/focus.ts`, unit-tested in `test/focus.test.ts`), filtered by `dimension`. A section with no net-losing entries is omitted entirely rather than shown empty; when ALL THREE are empty, a single positive empty state replaces them.
  - Only `net > 0` entries appear. Minimum sample: map ≥ 3 games, hero/role ≥ 8 games each — a hero/role bucket pools far more games than any one map, so a low floor there would surface noise before signal. The map dimension's `Unknown` placeholder bucket (games logged without a map id) is dropped — a placeholder can't be practiced.
  - **Ranking is per-dimension**, capped at **6 entries each** (three short sections, not one list one dimension can crowd out), by a **sample-aware deficit**: `net × (0.5 − Wilson-lower-bound(winrate))` (`src/core/targets/wilson.ts`, reused). A real deficit backed by a big sample (a genuinely bad winrate with many decided games) outranks a same-sized net that's really just a small, unreliable sample — net alone (the old rule) could let two small-sample rows with the same raw net rank arbitrarily, or let a lucky/unlucky streak on a tiny sample outrank a well-evidenced one.
  - **In-pool sorts first (H1):** within the Maps section, a map the master-data catalog marks out of the current competitive pool (`makeMapActive`) still gets a row — the history stays visible — but sorts behind every in-pool row regardless of score, carries an **"Out of pool"** tag, and loses the **Track as target** quick-create (practicing a map that isn't even in rotation doesn't help a real queue). A map missing from the catalog reads as in-pool (master data's own "missing ⇒ active" convention). Hero and role entries are always in-pool (no pool concept applies to them).
  - Row anatomy: name/label · **"Out of pool" tag** (map entries only, when applicable) · **mode chip** (map entries only, H2 — the same `mapType` pill Matches rows use, resolved in `dashboardData` from the master-data catalog) · trend readout (when present) · signed net · **net SR** (C2, `±N%`, colour-coded win/loss by its own sign — display only, never part of the ranking, which stays the sample-aware deficit over raw net; absent when nothing in the entry logged an SR change) · colour-coded winrate · games · deficit bar proportional to `net / maxNet` (the section's own worst entry — top row always full-width within its section).
  - **Trend readout** [explicit]: recent-half vs earlier-half winrate over the entry's games *in the filtered range*; requires ≥ 6 games; within ±5 winrate points reads flat. Rendered as a small tinted mono readout — ▴ `+N.N pts lately` (win colour) / → `holding steady` (muted) / ▾ `−N.N pts lately` (loss colour) — the same arrow/colour/label table (`components/trendArrow.ts`) the Heroes table's Trend column uses (H6), plus the point delta (H2) in the same grammar the since-flagged progress line already uses.
  - **Per-map hero record** (H2, map entries only): up to the top 3 heroes played in the map's games by game count, each showing its OWN per-game win/loss ("with Genji 1-4 · Tracer 0-2 · Sombra 1-0") — deliberately **per-game credit** (every hero in a swap game earns the whole result), not the Heroes screen's time-share credit, since a swap segment isn't "most of the game" on either hero. Each hero name opens that hero's drill-down drawer.
  - **Row click-through by dimension:** a map's name opens that map's own games on Matches (`{ map }`, H3); a smaller secondary "↗ Maps" link next to it flashes the entry on the Maps ranking instead — the one surface where "how does this map look overall" is still a distinct question from "which games". A hero's name opens that hero's drill-down drawer (`openHeroDrawer`, same as the Heroes table/palette/Matches cross-links). A role's name sets the global role filter to that role and opens Trends — "how has Tank been going" is a Trends-shaped question, not a Matches drill-down.
  - **Since-flagged progress** [explicit]: an entry linked to an active, non-archived authored target — preferring a target SCOPED (R9) directly to the entry's own map/role/hero (`mapScope`/`roleScope`/`heroScope`, exact match, immune to a later rename), falling back to the legacy name-token match (both sides normalized to lowercase alphanumerics so casing/apostrophe styles all link; a role also matches its camelCase-split display form, e.g. "Open Q") only among targets that carry NO scope for that dimension at all — a target deliberately scoped AWAY from an entry never links back in via its old name. The Notion bookkeeping pseudo-target never links; the most recently flagged candidate wins. Shows a progress line instead of the quick-create button: "▴ 4 pts since you flagged it (<date>) · N games since", or "◎ tracking "<target>" since <date> · N games since" while either window still has < 3 decided games. Progress is computed over the **unfiltered** competitive history (the target's lifetime, like staleness), with `deltaPts` = (winrate since − winrate before) × 100. An entry nothing links to simply shows the quick-create button — no error.
  - **Unlinked, in-pool rows keep the "Track as target" quick-create** (R9, renamed from "＋ target"): clicking it opens a small popover (`openPopover`) anchored to the button, explaining what tracking commits to — the prefilled name and "You grade it Hit/Partial/Missed after every matching game, and this row will show your progress since you started tracking it" — with a single confirm action that navigates to Targets with prefill "Practice <name>: warm up unranked + review one replay" and, for a hero, role or map entry (H1, R9), that hero/role/map pre-selected in the builder's Scope picker too (`ViewParams.prefillHeroes` / `.prefillRole` / `.prefillMap`).
- Positive empty state when nothing is net-losing across all three dimensions.
- **Build a focus routine** advice card: practice/review guidance copy ("Practice your bottom three before ranked and review one replay each…") + "Start a routine →" CTA navigating to the Targets screen.

## Out-of-Scope

- Any in-game practice/queue integration — no queue feature exists or is planned (GEP-only guardrail); no "queue" verb anywhere in the copy.
- A distinct "routine" feature — [confirmed] a routine **is** authoring a season-scoped improvement target; the CTA to the Targets builder is the intended flow.
- Mental/tilt analytics — owned by the Mental screen; Focus stays gameplay-only.
- Recency/SR-bleed weighting in the ranking formula beyond the Wilson-bound sample-awareness (H1); multi-pick routine hand-off (bottom-N → N targets in one action).

## Constraints

- [explicit] Ordering/trend come from the pre-ranked `focusItems` payload computed over the **filtered** range — the list describes what the filters show; only the linked-target progress deliberately reads the full history.
- [explicit] Bar widths are relative to the current section's worst entry, so each section's top row is always full-width.
- [explicit] `DashboardData.focusMaps` (map-only, top 8, no dimension/pool/mode data) exists but only feeds the Overview scatter callout — this screen does not read it. That callout gets its own, simpler "Out of pool" tag by cross-referencing `masterData.maps` directly in `overview.ts`, rather than sharing `FocusEntry`'s richer shape.
- [explicit] `FocusEntry.heroes`/`.mode` are populated for map entries only; `.inPool` defaults to `true`/absent for hero and role entries (no pool concept applies).

## Acceptance Criteria

- Given net-losing entries in range across maps/heroes/roles, when Focus renders, then each dimension with at least one qualifying entry gets its own section, entries worst-first by the sample-aware deficit, with signed net, winrate, games, and a proportional deficit bar.
- Given an entry with ≥ 6 games in range, then it carries a trend readout (▴/→/▾ plus the point delta) with an explanatory tooltip; with fewer games, none.
- Given a map entry whose games span 2+ heroes, then its row shows the top 3 heroes by game count with their own per-game W-L, each opening that hero's drawer.
- Given a map the master-data catalog marks inactive, then its row carries an "Out of pool" tag, sorts behind every in-pool map row regardless of score, and has no "Track as target" button.
- Given an active target scoped (R9) to an entry's own map/role/hero, then that row shows the since-flagged progress line (delta once both windows have ≥ 3 decided games) and no quick-create button, even if the target's name says nothing about the entry; given instead a target whose NAME mentions the entry's key but carries no scope for that dimension, the same link happens via the legacy fallback; given a target explicitly scoped to a DIFFERENT value for that dimension, it never links even if its name matches (no error).
- Given a click on "Track as target" on an unlinked, in-pool row, then a popover opens explaining what tracking creates; given a click on the popover's confirm button, then the app navigates to Targets with the practice-framed name prefilled, plus the matching role/hero/map scope pre-selected (H1, R9).
- Given a click on a hero row's name, then the hero's drill-down drawer opens; given a click on a role row's name, then the app sets the global role filter and opens Trends.
- Given nothing net-losing anywhere, then a single positive empty state is shown in place of all three sections.
- Given a click on "Start a routine →", then the app navigates to the Targets screen (where the routine is authored as a season target).

## Known gaps (intent ≠ code)

None identified — behavior matches intent.

## Open Questions

None.
