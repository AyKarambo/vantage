# Screen spec: Mental (`mental`)

**Source:** `renderer/src/views/mental.ts`, `src/core/mental.ts` · reverse-engineered 2026-07-04
**Provenance tags:** [explicit] stated in code/comments · [inferred] reconstructed from behavior · [confirmed] user decision (2026-07-04 spec review)

**Shared context:** Renders from a `DashboardData` snapshot via `ViewContext`; the global filter bar re-scopes the range.

## Intent (WHAT & WHY)

[explicit] Surface the signals the game never reports — self-logged tilt, comms quality, teammates — and quantify what tilt costs ("tilt tax") so the player actually takes breaks. Everything here is the manual (◎) layer, badged as such.

## In-Scope

- **State** card: Calm and Tilted composite bars (0–100) + break-reminder status line.
- **Tilt tax** card: winrate when calm vs. when tilted, with a message stating the point cost ("Tilt costs you about N points of winrate. Take the break.") or positive reinforcement when tilt isn't hurting.
- **Flags this range** card: counts of Tilt, Toxic mates, Leavers, Positive comms.

## Out-of-Scope

- Logging the flags (done in the quick-log modal; also planned via Review — see pipeline gap below).
- Any therapeutic/coaching content beyond the one-line nudges.

## Constraints

- [explicit] Data derives from per-match mental flags on stored game records (today: entered via the quick-log modal only).
- [explicit] Composite formula: `tilted = tilt-flag share`; `calm = 0.5·(1 − tiltShare) + 0.5·positiveCommsShare` — two deliberately independent axes.
- [explicit] Tilt tax = `(winWhenCalm − winWhenTilted)` in winrate points; at ≤0 the copy flips to reinforcement.

## Acceptance Criteria (current behavior)

- Given logged matches with mental flags in range, when Mental renders, then the calm/tilted bars, both split winrates, and the four flag counts reflect the filtered range.
- Given `winWhenCalm > winWhenTilted`, then the tax message states the rounded point cost and advises the break; otherwise the reinforcement message shows.
- Given no flagged matches, then the composites and splits render from the zero/default summary (no crash, no fake data).

## Known gaps (intent ≠ code)

- [confirmed] **The break-reminder line is misleading.** The UI states "Break reminder is **on** after 2 losses", but the threshold is a hardcoded constant (`breakReminderAfterLosses: 2` in `src/core/mental.ts`) and **no reminder fires anywhere** in the main process. Intended end state: a real break-reminder mechanism (e.g. tray notification after N consecutive losses) with a **user-configurable setting** (on/off + threshold). Until it exists, the UI must not claim it is "on".
- [confirmed] **Review flags must feed these stats** (full manual-data pipeline, shared with `screen-review.spec.md`): feel-flags saved on the Review screen currently live only in renderer `localStorage` and never reach the main store, so this screen ignores them. Intended: Review flags persist to the match record and are included in every number on this screen.

## Open Questions

None — both gaps resolved as confirmed intent 2026-07-04.
