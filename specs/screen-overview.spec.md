# Screen spec: Overview (`overview`)

**Source:** `renderer/src/views/overview.ts` · reverse-engineered 2026-07-04
**Provenance tags:** [explicit] stated in code/comments · [inferred] reconstructed from behavior · [confirmed] user decision (2026-07-04 spec review)

**Shared context:** Renders from a `DashboardData` snapshot via `ViewContext` (`renderer/src/views/view.ts`); the global filter bar (Account · Role · Mode · Season) re-scopes it; demo dataset shows a "Demo data" badge; Ctrl+K opens the quick-log modal from anywhere.

## Intent (WHAT & WHY)

[explicit] The landing screen — "priority maps at a glance". Answers in one glance: *how am I doing* (KPIs) and *where are the points hiding* (which maps bleed rank), so the player knows what to fix before queueing.

## In-Scope

- Greeting header: time-of-day greeting + player name, date + live winrate line, primary **Log match** CTA (opens quick-log modal).
- KPI row: **Winrate** (+ recent-form delta chip), **Games** (W·L split), **Rank** (SR + tier/division with direction arrow), **Streak** (accented, with "ride it" / "reset it" nudge).
- Scatter card: winrate × volume for every map in range; dot colour is a stable categorical per map; legend uses shortened map names with the full name on hover.
- **Top priority** callouts: top 3 net-losing maps (net = losses − wins > 0) with games, signed net, winrate; CTA "Build a focus routine →" navigates to Focus.
- Bottom row: **Focus queue** (top 4 net-losing maps; "▶ queue" navigates to Focus) and **Mental** snapshot (Calm/Tilted bars + break-reminder line).

## Out-of-Scope

- Drill-downs (no per-map or per-KPI navigation).
- Actual practice queueing — [confirmed] "▶ queue" is intentionally navigation-only; no queue feature is planned.
- The break-reminder mechanism itself (owned by `screen-mental.spec.md`).

## Constraints

- [explicit] Recent-form delta = mean winrate of the last ≤5 trend buckets minus the range baseline, in points; suppressed below 3 buckets — deliberately smoothed so one good day doesn't swing it.
- [explicit] Scatter flags a map as focus-worthy at net ≥ 3; maps sort most-played-first so legend order and per-map colours stay stable.
- [explicit] Winrate KPI shows "–" at 0 games.

## Acceptance Criteria (current behavior)

- Given maps with net > 0 in range, when Overview renders, then the 3 worst by net appear under "Top priority" with games, signed net, and winrate.
- Given no net-losing maps, when Overview renders, then the callout shows "No net-losing maps — clean season. 🎯".
- Given fewer than 3 trend buckets, when the KPI row renders, then the Winrate KPI has no delta chip.
- Given a click on "Build a focus routine →" or "▶ queue", then the app navigates to the Focus screen.
- Given a click on "Log match", then the quick-log modal opens.

## Known gaps (intent ≠ code)

- [confirmed] The Mental card repeats "Break reminder is **on** after N losses" — no reminder exists anywhere. Intended end state: a real break-reminder with a user-configurable setting (see `screen-mental.spec.md`).

## Open Questions

None — resolved 2026-07-04: "▶ queue" is navigation-only (label softening is optional polish, not a requirement).
