# Screen spec: Focus (`focus`)

**Source:** `renderer/src/views/focus.ts`, `src/core/analytics/focus.ts` · reverse-engineered 2026-07-04 · reworked 2026-07-08 per issue #71 (SDD spec #75): cross-dimension hub + trend/progress loop
**Provenance tags:** [explicit] stated in code/comments · [inferred] reconstructed from behavior · [confirmed] user decision (2026-07-04 spec review; 2026-07-08 issue #71 scope call)

**Shared context:** Renders from a `DashboardData` snapshot via `ViewContext`; the global filter bar re-scopes the list. Sits in the app's focus hierarchy [confirmed 2026-07-08]: **Overview teases** (single "Top priority" callout) → **Focus prioritizes** (this screen, the hub) → **Maps** stays the raw reference table → **Targets** is the commitment.

## Intent (WHAT & WHY)

[explicit] The cross-dimension "work on these" hub — the **maps, heroes and roles** where the player both loses a lot and plays a lot, merged into one priority list ranked by net deficit (net = losses − wins), because those cost the most rank. Each entry closes the loop: a trend verdict shows whether it is getting better or worse, and an entry already tracked by an improvement target shows the winrate movement since it was flagged.

## In-Scope

- **Work on these** card, rendered from `DashboardData.focusItems` (`focusEntries` + `linkFocusTargets`, `src/core/analytics/focus.ts`, unit-tested in `test/focus.test.ts`):
  - Entries span three dimensions — map, hero, role — each row tagged with a dimension pill (Map/Hero/Role; role keys display via `roleLabel`, e.g. `openQ` → "Open Q").
  - Only `net > 0` groups appear; ranked worst-first (net desc, ties by more games), capped at **12**. Per-dimension minimum samples: map ≥ 3 games, hero ≥ 3, role ≥ 5 (roles are only four broad buckets). Hero bucketing counts a game toward every hero played in it; the `Unknown` placeholder bucket is dropped.
  - Row anatomy: dimension pill · name · trend arrow (when present) · signed net · colour-coded winrate · games · deficit bar proportional to `net / maxNet` (top row always full-width).
  - **Trend arrow** [explicit]: recent-half vs earlier-half winrate over the entry's games *in the filtered range*; requires ≥ 6 games; within ±5 winrate points reads flat. ▴ improving (win colour) / → flat (muted) / ▾ declining (loss colour), tooltip explains the verdict.
  - **Since-flagged progress** [explicit]: an entry linked to an active, non-archived authored target (name mentions the entry key — both sides normalized to lowercase alphanumerics, so casing/apostrophe styles/role display labels all link; the Notion bookkeeping pseudo-target never links; the most recently flagged match wins) shows a progress line instead of the quick-create button: "▴ 4 pts since you flagged it (<date>) · N games since", or "◎ tracking "<target>" since <date> · N games since" while either window still has < 3 decided games. Progress is computed over the **unfiltered** competitive history (the target's lifetime, like staleness), with `deltaPts` = (winrate since − winrate before) × 100.
  - Unlinked rows keep the **＋ target** quick-create → navigates to Targets with prefill "Practice <name>: warm up unranked + review one replay".
- Positive empty state when nothing is net-losing.
- **Build a focus routine** advice card: practice/review guidance copy ("Practice your bottom three before ranked and review one replay each…") + "Start a routine →" CTA navigating to the Targets screen.

## Out-of-Scope

- Any in-game practice/queue integration — no queue feature exists or is planned (GEP-only guardrail); no "queue" verb anywhere in the copy [confirmed 2026-07-08].
- A distinct "routine" feature — [confirmed] a routine **is** authoring a season-scoped improvement target; the CTA to the Targets builder is the intended flow.
- Mental/tilt analytics — owned by the Mental screen (issue #70); Focus stays gameplay-only [confirmed 2026-07-08].
- **Deferred** (issue #71 directions, recorded 2026-07-08): **B** — smarter priority score (Wilson bound, recency, SR-bleed weighting); ranking stays raw net. **E** — multi-pick routine hand-off (bottom-N → N targets in one action).

## Constraints

- [explicit] Ordering/trend come from the pre-ranked `focusItems` payload computed over the **filtered** range — the list describes what the filters show; only the linked-target progress deliberately reads the full history.
- [explicit] Bar widths are relative to the current worst entry, so the top row is always full-width.
- [explicit] `DashboardData.focusMaps` (map-only, top 8) still exists but only feeds the Overview scatter callout — this screen no longer reads it.

## Acceptance Criteria (current behavior)

- Given net-losing maps, heroes and roles in range, when Focus renders, then they appear in one list tagged by dimension, worst-first with signed net, winrate, games, and a proportional deficit bar.
- Given an entry with ≥ 6 games in range, then it carries a trend arrow (▴/→/▾) with an explanatory tooltip; with fewer games, no arrow.
- Given an active target whose name mentions an entry's key, then that row shows the since-flagged progress line (delta once both windows have ≥ 3 decided games) and no quick-create button.
- Given a click on "＋ target" on an unlinked row, then the app navigates to Targets with the practice/review prefill.
- Given no net-losing entries, then "Nothing is net-losing right now — nice. 🎯" is shown.
- Given a click on "Start a routine →", then the app navigates to the Targets screen (where the routine is authored as a season target).

## Known gaps (intent ≠ code)

None identified — behavior matches intent.

## Open Questions

None — resolved 2026-07-08 (issue #71): Focus is the cross-dimension hub (direction A), the three former focus surfaces are de-duplicated into the Overview-tease → Focus-hub hierarchy (D), and the trend/progress loop ships (C). Directions B and E are deferred, not open.
