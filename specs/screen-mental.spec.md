# Screen spec: Mental (`mental`)

**Source:** `renderer/src/views/mental.ts`, `src/core/mental.ts`, `src/core/breakReminder.ts` · reverse-engineered 2026-07-04 · updated 2026-07-04 after gap implementation
**Provenance tags:** [explicit] stated in code/comments · [inferred] reconstructed from behavior · [confirmed] user decision (2026-07-04 spec review) · [implemented 2026-07-04] shipped in the gap-closing pass

**Shared context:** Renders from a `DashboardData` snapshot via `ViewContext`; the global filter bar re-scopes the range.

## Intent (WHAT & WHY)

[explicit] Surface the signals the game never reports — self-logged tilt, comms quality, teammates — and quantify what tilt costs ("tilt tax") so the player actually takes breaks. Everything here is the manual (◎) layer, badged as such.

## In-Scope

- **State** card: Calm and Tilted composite bars (0–100) + a break-reminder settings editor — [implemented 2026-07-04] an on/off chip plus a threshold `<select>` (1–5 losses in the UI), editing the real, persisted setting in place (no navigation to a separate settings surface).
- **Tilt tax** card: winrate when calm vs. when tilted, with a message stating the point cost ("Tilt costs you about N points of winrate. Take the break.") or positive reinforcement when tilt isn't hurting.
- **Flags this range** card: counts of Tilt, Toxic mates, Leavers, Positive comms — [implemented 2026-07-04] each count now OR-merges the quick-log flag with the Review-screen flag on the same game (`GameRecord.mental` and `GameRecord.review.flags`), so a game flagged from either source counts exactly once.

## Out-of-Scope

- Logging the flags (done in the quick-log modal and on the Review screen, per active target — see `screen-review.spec.md`).
- Any therapeutic/coaching content beyond the one-line nudges.
- A history/log of past break-reminder toasts (only the live on/off + threshold state is shown).

## Constraints

- [explicit] Data derives from per-match mental flags on stored game records: the quick-log modal's `GameRecord.mental` and the Review screen's `GameRecord.review.flags`, OR-merged per flag.
- [explicit] Composite formula: `tilted = tilt-flag share`; `calm = 0.5·(1 − tiltShare) + 0.5·positiveCommsShare` — two deliberately independent axes.
- [explicit] Tilt tax = `(winWhenCalm − winWhenTilted)` in winrate points; at ≤0 the copy flips to reinforcement.
- [implemented 2026-07-04] The break-reminder state machine (`src/core/breakReminder.ts`) is pure and Electron-free: given the current loss streak, settings, and prior fire-state, it decides whether to fire now. It fires at the configured threshold and re-fires every further `afterLosses` losses (not on every subsequent loss), and re-arms as soon as the streak stops being a loss streak (a win, or no decided games). The main process evaluates it after every recorded game — from **both** ingestion paths (the live GEP feed and the manual Log Match modal) — against the **unfiltered** history, so a manually logged loss counts the same as a live one.
- [implemented 2026-07-04] Firing sends a Windows tray toast: "Time for a break?" / "That's N losses in a row — step away for a few minutes."
- [implemented 2026-07-04] Settings: `enabled` (on/off) and `afterLosses` (threshold). The UI offers 1–5; the core clamps any input to 1–10. Default is `{ enabled: true, afterLosses: 2 }`. Persisted to `config.local.json` via `setBreakReminder`/`getBreakReminder`; edited directly from this screen's State card.
- [implemented 2026-07-04] Reminder fire-state (how many losses have already triggered a toast for the current streak) is held **in-memory only** in the main process — an app restart re-arms it. This is an accepted trade-off, not a bug (see Known gaps).

## Acceptance Criteria (current behavior)

- Given logged matches with mental flags in range, when Mental renders, then the calm/tilted bars, both split winrates, and the four flag counts reflect the filtered range.
- Given `winWhenCalm > winWhenTilted`, then the tax message states the rounded point cost and advises the break; otherwise the reinforcement message shows.
- Given no flagged matches, then the composites and splits render from the zero/default summary (no crash, no fake data).
- Given the break reminder is enabled, when the State card renders, then it shows an "on" chip and a threshold select (1–5 losses) bound to the persisted setting.
- Given the break reminder is disabled, when the State card renders, then it shows an "off" chip and the threshold select is disabled.
- Given the user toggles the chip or changes the threshold, then the new settings persist via `setBreakReminder` and the screen (and Overview's Mental snapshot) reflect the change on refresh.
- Given the tracked loss streak reaches the configured threshold (via either GEP or a manual log), then a tray toast fires once for that streak-count; a further loss short of `afterLosses` more does not re-fire; reaching `threshold + afterLosses` fires again.
- Given a win (or a game with no decided result) breaks the loss streak, then the reminder re-arms — the next loss streak fires again starting from the threshold.
- Given a flag was saved via the Review screen instead of the quick-log modal, then it still counts in this screen's flag totals and composites (OR-merged, once per game).

## Known gaps (intent ≠ code)

None identified — behavior matches intent. One accepted, documented limitation remains:

- [confirmed] **Reminder fire-state is in-memory.** Restarting the app re-arms the break reminder (any partial progress toward the next re-fire is lost); this is an accepted trade-off, not a defect. A persisted fire-state was not required by the confirmed intent.

## Open Questions

None — both 2026-07-04 gaps (real break reminder; Review flags feeding these stats) are now implemented.
