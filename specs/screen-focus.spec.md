# Screen spec: Focus (`focus`)

**Source:** `renderer/src/views/focus.ts` · reverse-engineered 2026-07-04 · re-verified 2026-07-04 after the ui-qol / live-status / debug-log batch (PR #8): no screen-level changes
**Provenance tags:** [explicit] stated in code/comments · [inferred] reconstructed from behavior · [confirmed] user decision (2026-07-04 spec review)

**Shared context:** Renders from a `DashboardData` snapshot via `ViewContext`; the global filter bar re-scopes the list. The ui-qol batch touched this screen only through shell-level behaviors (palette Screen entry, Ctrl+1…9 hotkeys, flicker-free refresh, filter reset chip/presets) — all specified in `screen-shell.spec.md`.

## Intent (WHAT & WHY)

[explicit] The "work on these" list — maps where the player both loses a lot and plays a lot, ranked by net deficit (net = losses − wins), because those cost the most rank. The screen converts the season's data into a short, actionable practice list.

## In-Scope

- **Priority maps** card: net-losing maps ranked worst-first; each row shows map name, signed net, winrate (colour-coded), games, and a deficit bar whose width is proportional to `net / maxNet` (scaled to the worst offender).
- Positive empty state when nothing is net-losing.
- **Build a focus routine** advice card: practice guidance copy + "Start a routine →" CTA navigating to the Targets screen.

## Out-of-Scope

- Any in-game practice/queue integration.
- A distinct "routine" feature — [confirmed] a routine **is** authoring a season-scoped improvement target; the CTA to the Targets builder is the intended flow, not a stopgap.

## Constraints

- [explicit] Only maps with net > 0 appear; ordering comes from the pre-ranked `focusMaps` payload (worst deficit first).
- [explicit] Bar widths are relative to the current worst map, so the top row is always full-width.

## Acceptance Criteria (current behavior)

- Given net-losing maps in range, when Focus renders, then they list worst-first with signed net, winrate, games, and a proportional deficit bar.
- Given no net-losing maps, then "No net-losing maps right now — nice. 🎯" is shown.
- Given a click on "Start a routine →", then the app navigates to the Targets screen (where the routine is authored as a season target).

## Known gaps (intent ≠ code)

None identified — behavior matches intent. (The routine ≡ target equivalence is documented intent, not a gap.)

## Open Questions

None — resolved 2026-07-04: routine = authoring a season target; the Overview → Focus → Targets CTA chain is intended.
