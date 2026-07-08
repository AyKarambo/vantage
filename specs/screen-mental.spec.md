# Screen spec: Mental (`mental`)

**Source:** `renderer/src/views/mental.ts`, `renderer/src/components/breakReminderEditor.ts`, `src/core/mental.ts`, `src/core/mentalAnalytics.ts`, `src/core/breakReminder.ts` · reverse-engineered 2026-07-04 · updated 2026-07-04 after gap implementation · updated 2026-07-04 after the ui-qol batch (PR #8) · updated 2026-07-08 for the mental-analytics feature (issue #70, spec issue #76)
**Provenance tags:** [explicit] stated in code/comments · [inferred] reconstructed from behavior · [confirmed] user decision (2026-07-04 spec review) · [implemented 2026-07-04] shipped in the gap-closing pass · [qol 2026-07-04] shipped in the ui-qol batch (intent: `ui-qol.spec.md`) · [analytics 2026-07-08] shipped in the mental-analytics feature (issue #70)

**Shared context:** Renders from a `DashboardData` snapshot via `ViewContext`; the global filter bar re-scopes the range.

## Intent (WHAT & WHY)

[explicit] Surface the signals the game never reports — self-logged tilt, comms quality, teammates — and quantify what tilt costs ("tilt tax") so the player actually takes breaks. Everything here is the manual (◎) layer, badged as such.

## In-Scope

- **State** card: Calm and Tilted composite bars (0–100) + a break-reminder settings editor — [implemented 2026-07-04] an on/off chip plus a threshold `<select>` (1–5 losses in the UI), editing the real, persisted setting in place. [qol 2026-07-04] The editor is now the shared `breakReminderEditor` component, used identically here and on the Settings screen: the **canonical settings home is Settings** (`screen-settings.spec.md`, per `ui-qol.spec.md` resolved question 7), and Mental keeps this inline copy where the stat lives — both edit the same persisted config. Changes apply immediately and show an Undo toast that restores the previous settings.
- **What it costs you** card — [analytics 2026-07-08] the tilt tax generalized into five sample-gated rows, all derived in `src/core/mentalAnalytics.ts` (`mentalCosts`, on `DashboardData.mentalCosts`):
  - **Tilt tax** — winrate calm vs tilted (replaces the former standalone *Tilt tax* card).
  - **Comms tax** — winrate with positive vs abusive comms (games with neither tone sit in neither side; a source-conflicted game counts as positive).
  - **Toxic mates** — winrate without vs with toxic teammates.
  - **Leaver swing** — three-way: my-team leaver vs no leaver vs enemy leaver. The verdict prices my-team vs none; the enemy side is reported separately (its swing should be positive and must never mask a my-team cost). A both-teams-leaver game counts on the my-team side.
  - **Performance when tilted** — mean 0–100 self-rating calm vs tilted (gated on rated games).
  Every row shows both sides + the point delta only when BOTH sides carry ≥ `COST_MIN_SAMPLE` (5) decided (or rated) games; otherwise a dim needs-data line with the current counts.
- **Trends** card — [analytics 2026-07-08] the per-day tilt-rate sparkline (dependency-free SVG, `DashboardData.tiltTrend` from `tiltTrend()`), plus an improving/worsening/flat read (`tiltTrendDirection()`: range halved by game count, both halves gated on 5 games, 3-point dead zone → flat). Fewer than 2 days → an empty-state hint.
- **Session & triggers** card — [analytics 2026-07-08] tilt rate by game number within a sitting (`DashboardData.tiltBySession` from `tiltBySessionPosition()`): one bar per position ('1'…'5', '6+'), numbered over the UNFILTERED history with the 90-minute gap convention (the filter scopes which games aggregate, never renumbers sittings — same as the Trends screen's winrate-by-position). A gated hint names the peak-tilt position (≥ 5 games and ≥ 1 tilted game); a game-1 peak flips the copy from "plan the break before then" to a queue-up check-in.
- **Flags this range** card: counts of Tilt, Toxic mates, Leaver — my team, Leaver — enemy, Positive comms, Abusive comms (six boxes) — [implemented 2026-07-04] each count OR-merges the quick-log flag with the Review-screen flag on the same game (`GameRecord.mental` and `GameRecord.review.flags`), so a game flagged from either source counts exactly once. [analytics 2026-07-08] The leaver count renders split into my-team / enemy boxes from `MentalSummary.flags.leaverMyTeam` / `.leaverEnemyTeam` (a legacy single `leaver: true` counts as my-team); both boxes drill into the combined `'leaver'` Matches filter.

## Out-of-Scope

- Logging the flags (done in the quick-log modal and on the Review screen, per active target — see `screen-review.spec.md`).
- Any therapeutic/coaching content beyond the one-line nudges.
- A history/log of past break-reminder toasts (only the live on/off + threshold state is shown).
- [analytics 2026-07-08, deferred] Widening the Matches drill-down to distinguish my-team vs enemy leavers: `MatchFlagKey` keeps its single `'leaver'` key (driving `rowFlags()`, `MatchRow.flags`, and the Matches flag filter); both leaver boxes navigate to the combined leaver drill-down. Explicitly deferred in spec issue #76.
- [analytics 2026-07-08] The rest of the issue #70 analytics menu (calm-score/comms-tone trends, tilt contagion, tilt by time of day/map/role/hero, tilt streaks, clean-vs-external losses, comms-tone distribution) — future scope.
- Feeding the session-position tilt read into the break-reminder threshold automatically (the analytic informs, the setting stays manual).

## Constraints

- [explicit] Data derives from per-match mental flags on stored game records: the quick-log modal's `GameRecord.mental` and the Review screen's `GameRecord.review.flags`, OR-merged per flag.
- [explicit] Composite formula: `tilted = tilt-flag share`; `calm = 0.5·(1 − tiltShare) + 0.5·positiveCommsShare` — two deliberately independent axes.
- [explicit] Tilt tax = `(winWhenCalm − winWhenTilted)` in winrate points; at ≤0 the copy flips to reinforcement — [analytics 2026-07-08] now one row of the *What it costs you* card, priced from `mentalCosts.tilt` with the same semantics.
- [analytics 2026-07-08] All cost/trend/session derivations live in pure, Electron-free `src/core/mentalAnalytics.ts` with unit tests (`test/mentalAnalytics.test.ts`); the view only formats and gates on the shared `COST_MIN_SAMPLE` constant. New payload fields (`mentalCosts`, `tiltTrend`, `tiltBySession`) ride the typed IPC contract.
- [analytics 2026-07-08] Draws never count toward a decided sample; a 0/0 side's winrate sentinel is never rendered as a delta.
- [implemented 2026-07-04] The break-reminder state machine (`src/core/breakReminder.ts`) is pure and Electron-free: given the current loss streak, settings, and prior fire-state, it decides whether to fire now. It fires at the configured threshold and re-fires every further `afterLosses` losses (not on every subsequent loss), and re-arms as soon as the streak stops being a loss streak (a win, or no decided games). The main process evaluates it after every recorded game — from **both** ingestion paths (the live GEP feed and the manual Log Match modal) — against the **unfiltered** history, so a manually logged loss counts the same as a live one.
- [implemented 2026-07-04] Firing sends a Windows tray toast: "Time for a break?" / "That's N losses in a row — step away for a few minutes."
- [implemented 2026-07-04] Settings: `enabled` (on/off) and `afterLosses` (threshold). The UI offers 1–5; the core clamps any input to 1–10. Default is `{ enabled: true, afterLosses: 2 }`. Persisted to `config.local.json` via `setBreakReminder`/`getBreakReminder`; [qol 2026-07-04] editable from this screen's State card *and* from the Settings screen through the same shared component — one persisted setting, two surfaces, each edit undoable via toast.
- [implemented 2026-07-04] Reminder fire-state (how many losses have already triggered a toast for the current streak) is held **in-memory only** in the main process — an app restart re-arms it. This is an accepted trade-off, not a bug (see Known gaps).

## Acceptance Criteria (current behavior)

- Given logged matches with mental flags in range, when Mental renders, then the calm/tilted bars, the cost rows, and the six flag counts (leavers split my-team/enemy) reflect the filtered range.
- Given ≥ 5 decided (or rated) games on both sides of a cost split, then that row prices the delta in winrate points (self-rating points for the performance row); a positive cost renders as a red −N, a benefit as a green +N.
- Given fewer than 5 on either side, then the row shows a dim needs-data line with the current per-side counts — never a delta off a thin or 0/0 sample.
- Given games with enemy-team leavers, then the leaver-swing row reports the enemy side separately from the my-team side (three-way), and the Flags footer counts them in their own box.
- Given tilt-flagged games across ≥ 2 days, then the Trends card draws the per-day tilt-rate sparkline and, when both range-halves carry ≥ 5 games, an improving/worsening/flat read (3-point dead zone).
- Given games across sittings, then Session & triggers shows the tilt rate per session position, numbered over the unfiltered history (a role/date filter scopes aggregation without renumbering), with the gated peak-position hint.
- Given no flagged matches (or an empty range), then every card renders its zero/empty state (no crash, no fake data).
- Given the break reminder is enabled, when the State card renders, then it shows an "on" chip and a threshold select (1–5 losses) bound to the persisted setting.
- Given the break reminder is disabled, when the State card renders, then it shows an "off" chip and the threshold select is disabled.
- Given the user toggles the chip or changes the threshold (here or in Settings), then the new settings persist via `setBreakReminder`, a "Break reminder updated" toast with Undo appears, and the screen (plus Overview's Mental snapshot and the Settings card) reflect the change on refresh; Undo restores the previous settings.
- Given the tracked loss streak reaches the configured threshold (via either GEP or a manual log), then a tray toast fires once for that streak-count; a further loss short of `afterLosses` more does not re-fire; reaching `threshold + afterLosses` fires again.
- Given a win (or a game with no decided result) breaks the loss streak, then the reminder re-arms — the next loss streak fires again starting from the threshold.
- Given a flag was saved via the Review screen instead of the quick-log modal, then it still counts in this screen's flag totals and composites (OR-merged, once per game).

## Known gaps (intent ≠ code)

None identified — behavior matches intent. One accepted, documented limitation remains:

- [confirmed] **Reminder fire-state is in-memory.** Restarting the app re-arms the break reminder (any partial progress toward the next re-fire is lost); this is an accepted trade-off, not a defect. A persisted fire-state was not required by the confirmed intent.

## Open Questions

None — both 2026-07-04 gaps (real break reminder; Review flags feeding these stats) are now implemented.
