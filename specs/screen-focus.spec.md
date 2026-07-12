# Screen spec: Focus (`focus`)

**Source:** `renderer/src/views/focus.ts`, `src/core/analytics/focus.ts`
**Provenance tags:** [explicit] stated in code/comments · [inferred] reconstructed from behavior · [confirmed] user decision

**Shared context:** Renders from a `DashboardData` snapshot via `ViewContext`; the global filter bar re-scopes the list. Sits in the app's focus hierarchy: **Overview teases** (single "Top priority" callout) → **Focus prioritizes** (this screen, the hub) → **Maps** stays the raw reference table → **Targets** is the commitment.

## Intent (WHAT & WHY)

[explicit] The "work on these" hub — the **maps** where the player both loses a lot and plays a lot, ranked by net deficit (net = losses − wins), because those cost the most rank. Each entry closes the loop: a trend verdict shows whether it is getting better or worse, and an entry already tracked by an improvement target shows the winrate movement since it was flagged.

## In-Scope

- **Work on these** card, rendered from `DashboardData.focusItems` (`focusEntries` + `linkFocusTargets`, `src/core/analytics/focus.ts`, unit-tested in `test/focus.test.ts`):
  - Entries are maps. Only `net > 0` maps appear; ranked worst-first (net desc, ties by more games), capped at **12**. Minimum sample: map ≥ 3 games. The `Unknown` placeholder bucket (games logged without a map id) is dropped — a placeholder can't be practiced.
  - Row anatomy: name · trend arrow (when present) · signed net · colour-coded winrate · games · deficit bar proportional to `net / maxNet` (top row always full-width).
  - **Trend arrow** [explicit]: recent-half vs earlier-half winrate over the entry's games *in the filtered range*; requires ≥ 6 games; within ±5 winrate points reads flat. ▴ improving (win colour) / → flat (muted) / ▾ declining (loss colour), tooltip explains the verdict.
  - **Since-flagged progress** [explicit]: an entry linked to an active, non-archived authored target (name mentions the map key — both sides normalized to lowercase alphanumerics, so casing/apostrophe styles all link; the Notion bookkeeping pseudo-target never links; the most recently flagged match wins) shows a progress line instead of the quick-create button: "▴ 4 pts since you flagged it (<date>) · N games since", or "◎ tracking "<target>" since <date> · N games since" while either window still has < 3 decided games. Progress is computed over the **unfiltered** competitive history (the target's lifetime, like staleness), with `deltaPts` = (winrate since − winrate before) × 100. A target whose name mentions no map key simply never links — no error.
  - Unlinked rows keep the **＋ target** quick-create → navigates to Targets with prefill "Practice <name>: warm up unranked + review one replay".
- Positive empty state when no map is net-losing.
- **Build a focus routine** advice card: practice/review guidance copy ("Practice your bottom three before ranked and review one replay each…") + "Start a routine →" CTA navigating to the Targets screen.

## Out-of-Scope

- Any in-game practice/queue integration — no queue feature exists or is planned (GEP-only guardrail); no "queue" verb anywhere in the copy.
- A distinct "routine" feature — [confirmed] a routine **is** authoring a season-scoped improvement target; the CTA to the Targets builder is the intended flow.
- Mental/tilt analytics — owned by the Mental screen; Focus stays gameplay-only.
- Hero and role focus rows — Focus ranks maps only. A smarter priority score (Wilson bound, recency, SR-bleed weighting) and multi-pick routine hand-off (bottom-N → N targets in one action) are out of scope; ranking stays raw net.

## Constraints

- [explicit] Ordering/trend come from the pre-ranked `focusItems` payload computed over the **filtered** range — the list describes what the filters show; only the linked-target progress deliberately reads the full history.
- [explicit] Bar widths are relative to the current worst entry, so the top row is always full-width.
- [explicit] `DashboardData.focusMaps` (map-only, top 8) exists but only feeds the Overview scatter callout — this screen does not read it.

## Acceptance Criteria

- Given net-losing maps in range, when Focus renders, then they appear in one list, worst-first with signed net, winrate, games, and a proportional deficit bar.
- Given an entry with ≥ 6 games in range, then it carries a trend arrow (▴/→/▾) with an explanatory tooltip; with fewer games, no arrow.
- Given an active target whose name mentions an entry's map key, then that row shows the since-flagged progress line (delta once both windows have ≥ 3 decided games) and no quick-create button; a target mentioning no map key never links (no error).
- Given a click on "＋ target" on an unlinked row, then the app navigates to Targets with the practice/review prefill.
- Given no net-losing maps, then "No maps are net-losing right now — nice. 🎯" is shown.
- Given a click on "Start a routine →", then the app navigates to the Targets screen (where the routine is authored as a season target).

## Known gaps (intent ≠ code)

None identified — behavior matches intent.

## Open Questions

None.
