# Screen spec: Overview (`overview`)

**Source:** `renderer/src/views/overview.ts`, `src/core/analytics/session.ts` (`sessionRecap`) · reverse-engineered 2026-07-04 · updated 2026-07-04 after gap implementation · updated 2026-07-04 after the ui-qol batch (PR #8)
**Provenance tags:** [explicit] stated in code/comments · [inferred] reconstructed from behavior · [confirmed] user decision (2026-07-04 spec review) · [implemented 2026-07-04] shipped in the gap-closing pass · [qol 2026-07-04] shipped in the ui-qol batch (intent: `ui-qol.spec.md`)

**Shared context:** Renders from a `DashboardData` snapshot via `ViewContext` (`renderer/src/views/view.ts`); the global filter bar (Account · Role · Mode · Season) re-scopes it; demo dataset shows a "Demo data" badge. [qol 2026-07-04] Ctrl+K now opens the **command palette** (see `screen-shell.spec.md`), not the quick-log modal directly — the quick-log opens via this screen's **Log match** CTA or the palette's Log match action (the palette's empty-query default, so Ctrl+K → Enter still logs a match).

## Intent (WHAT & WHY)

[explicit] The landing screen — "priority maps at a glance". Answers in one glance: *how am I doing* (KPIs) and *where are the points hiding* (which maps bleed rank), so the player knows what to fix before queueing.

## In-Scope

- Greeting header: time-of-day greeting + player name, date + live winrate line, primary **Log match** CTA (opens quick-log modal).
- [qol 2026-07-04] **Session recap card** ("Yesterday's session", glow-variant, rendered above the KPI row): shown when yesterday (the previous calendar day) had games and today's recap hasn't been dismissed yet. Sub-line: game count · "toughest: `<worst map>`" (when known) · "tilt flagged ×N" (when any). Four stat boxes: `W–L` (tinted by net) with signed net, winrate, best map (or "—"), targets-hit rate (or "—"). A ✕ dismiss button persists the recap's day-key (`recapShown` pref) so the card renders once per day; it also disappears for the rest of the day once dismissed.
- KPI row: **Winrate** (+ recent-form delta chip), **Games** (W·L split), **Rank** (tier/division with the within-division progress percentage and a direction arrow), **Streak** (accented, with "ride it" / "reset it" nudge).
- Scatter card: winrate × volume for every map in range; dot colour is a stable categorical per map; legend uses shortened map names with the full name on hover.
- **Top priority** callouts: top 3 net-losing maps (net = losses − wins > 0) with games, signed net, winrate; CTA "Build a focus routine →" navigates to Focus.
- Bottom row: **Focus queue** (top 4 net-losing maps; "▶ queue" navigates to Focus) and **Mental** snapshot (Calm/Tilted bars + break-reminder line — [implemented 2026-07-04] now truthful, reflecting the real per-user setting owned by `screen-mental.spec.md`).

## Out-of-Scope

- Drill-downs (no per-map or per-KPI navigation).
- Actual practice queueing — [confirmed] "▶ queue" is intentionally navigation-only; no queue feature is planned.
- The break-reminder mechanism itself (owned by `screen-mental.spec.md`).

## Constraints

- [explicit] Recent-form delta = mean winrate of the last ≤5 trend buckets minus the range baseline, in points; suppressed below 3 buckets — deliberately smoothed so one good day doesn't swing it.
- [explicit] Scatter flags a map as focus-worthy at net ≥ 3; maps sort most-played-first so legend order and per-map colours stay stable.
- [explicit] Winrate KPI shows "–" at 0 games.
- [qol 2026-07-04] The recap is computed in pure core (`sessionRecap`, `src/core/analytics/session.ts`, unit-tested) over the **unfiltered** history — the recap is about the player's day, not the current filter scope — and delivered as `DashboardData.recap` (absent when yesterday had no games). Best/worst map are only set when the day had ≥2 distinct maps; the targets-hit rate only when at least one target grade was saved that day.

## Acceptance Criteria (current behavior)

- Given maps with net > 0 in range, when Overview renders, then the 3 worst by net appear under "Top priority" with games, signed net, and winrate.
- Given no net-losing maps, when Overview renders, then the callout shows "No net-losing maps — clean season. 🎯".
- Given fewer than 3 trend buckets, when the KPI row renders, then the Winrate KPI has no delta chip.
- Given a click on "Build a focus routine →" or "▶ queue", then the app navigates to the Focus screen.
- Given a click on "Log match", then the quick-log modal opens.
- Given games were played yesterday and no recap has been dismissed today, when Overview renders, then the "Yesterday's session" card shows W–L + net, winrate, best map, and targets-hit; clicking ✕ dismisses it for the rest of the day (and it stays gone across relaunches that day).
- Given yesterday had no games, then no recap card renders.

## Known gaps (intent ≠ code)

None identified — behavior matches intent. [implemented 2026-07-04] The Mental card's break-reminder line now reads the real setting from `DashboardData.breakReminder` and renders truthfully: "Break reminder is **on** after N losses." when enabled, or the muted "Break reminder is off — turn it on in Mental." when disabled. The reminder mechanism itself (state machine, tray toast, on/off + threshold editor) is owned and specified by `screen-mental.spec.md`.

## Open Questions

None — resolved 2026-07-04: "▶ queue" is navigation-only (label softening is optional polish, not a requirement).
