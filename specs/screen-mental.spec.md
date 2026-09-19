# Screen spec: Mental (`mental`)

**Source:** `renderer/src/views/mental.ts`, `renderer/src/components/breakReminderEditor.ts`, `src/core/mental.ts`, `src/core/mentalAnalytics.ts` (`COST_MIN_SAMPLE`), `src/core/breakReminder.ts`, `renderer/src/components/primitives/unlock.ts` (`unlockHint`, F1).

**Shared context:** Renders from a `DashboardData` snapshot via `ViewContext`; the global filter bar re-scopes the range.

## Intent

Surface the signals the game never reports — self-logged tilt, comms quality, teammates — and quantify what tilt costs ("tilt tax") so the player actually takes breaks. Everything here is the manual (◎) layer, badged as such.

## Layout & behaviour

- **State card:** Calm and Tilted composite bars (0–100), each shown as a percentage with a title explaining its formula and a card `sub` stating the two are independent reads, not a split (S8); Tilted's value is a link into Matches scoped to `flag=tilt`. Below them, a break-reminder editor (the shared `breakReminderEditor`: an on/off chip + a threshold `<select>`, 1–5 losses, disabled while off, plus a hint stating what firing actually does — a Windows tray notification, re-firing every `afterLosses` further losses). The canonical settings home is Settings (`screen-settings.spec.md`); Mental keeps this inline copy where the stat lives — both edit the same persisted config. Changes apply immediately; no toast (deliberately — see the component's own comment).
- **"What it costs you" card** (S8) — sub states the unit once ("winrate points lost on the bad side · needs ≥`COST_MIN_SAMPLE` decided games each side") instead of every row repeating "pts" with no definition; each verdict carries a title spelling out the arithmetic. Five sample-gated cost rows, derived in `src/core/mentalAnalytics.ts` (`mentalCosts`):
  - **Tilt tax** — winrate calm vs tilted.
  - **Comms tax** — winrate with positive vs abusive comms (a source-conflicted game counts as positive).
  - **Toxic mates** — winrate without vs with toxic teammates.
  - **Leaver swing** — three-way: my-team leaver vs no leaver vs enemy leaver. The verdict prices my-team vs none; the enemy side is reported separately. The my-team-side percentage links into Matches scoped to `flag=leaver`.
  - **Performance when tilted** — mean 0–100 self-rating calm vs tilted (gated on rated games), shown as "−N / 100 self-rating".
  Every row shows both sides + the point delta only when BOTH sides carry ≥ `COST_MIN_SAMPLE` (5) decided (or rated) games; otherwise a shared **`unlockHint`** readout (F1) — one progress track per side, each clamped to a check mark the instant THAT side individually meets the floor, e.g. "5 of 5 calm ✓ · 2 of 5 tilted" — never the raw "12/5 calm" the old inline counts could print once only one side had cleared it. Tilt tax and Comms tax's bad-side percentage (tilted / abusive) also links into Matches scoped to that flag.
- **Trends card** — a per-day tilt-rate line chart (S9: the shared `charts/plots/lineChart` — same rolling-average/season-marker/Chart⇄Table toggle machinery as the winrate trend, reused via its optional `tooltipText` formatter rather than forked, since a 0..1 tilt rate is a structural fit for `WrPoint.winrate`) plus an improving/worsening/flat read (`tiltTrendDirection()`: range halved by game count, both halves gated on 5 games, 3-point dead zone → flat). The read now states the actual move, not just its sign — "↓ Improving — 22% → 15% (earlier vs recent half)." Fewer than 2 days → an empty-state hint.
- **Session & triggers card** — tilt rate by game number within a sitting (`tiltBySessionPosition()`): one bar per position ('1'…'5', '6+'), numbered over the UNFILTERED history with the 90-minute gap convention (the filter scopes which games aggregate, never renumbers sittings). A gated hint names the peak-tilt position; a game-1 peak flips the copy to a queue-up check-in. Below that, three more "when do I tilt" triggers (S9, `src/core/mentalAnalytics.ts`), stacked vertically below a divider since the card already sits in a 2-column grid:
  - **Time of day** (`tiltByTimeOfDay()`) — tilt rate per local day-part (Morning/Afternoon/Evening/Night, the same boundaries `byTimeOfDay` uses elsewhere), with a hint naming the worst and best day-part once both clear `COST_MIN_SAMPLE`.
  - **After your last game** (`tiltAfterResult()`) — tilt rate in games whose previous game in the SAME sitting was a win vs a loss (a sitting-opener has no prior game and isn't counted either way; reuses the same 90-minute gap boundary as the position split). Gated hint states the after-loss/after-win ratio, e.g. "You tilt 1.4× as often right after a loss — that's the break the reminder is for."
  - **By map** (`tiltByMap()`) — top 3 maps by tilt rate, 3+ games floor.
  Below all four, the shared **stop-rule line** (`components/stopRuleLine.ts`, S10 phase 1) combines the game-position tilt peak (falling back to the winrate-fade position when tilt has no sample-gated peak) with the break reminder's threshold into one sentence — "Your stop rule: end after game 3 or 2 losses in a row." — with a **Set the break reminder to match →** action when a stop point is readable but the reminder is off. The same line renders on Overview's Mental card and the idle Live screen, reading the identical `stopRule()` in `src/core/stopRule.ts`.
- **Flags this range card:** counts of Tilt, Toxic mates, Leaver — my team, Leaver — enemy, Positive comms, Abusive comms (six boxes). Each count OR-merges the quick-log flag with the Review-screen flag on the same game, so a game flagged from either source counts once. The leaver count is split my-team / enemy (a legacy single `leaver: true` counts as my-team); both boxes drill into the combined `'leaver'` Matches filter. A non-zero box wears `.stat-box--link` (accent border, hover lift, trailing arrow, S8) so it reads as a drill-down instead of looking identical to a plain stat; a zero count is dimmed instead.

## Out-of-Scope

- Logging the flags (done in the quick-log modal and on the Review screen, per active target — see `screen-review.spec.md`).
- Any therapeutic/coaching content beyond the one-line nudges.
- A history/log of past break-reminder toasts (only the live on/off + threshold state is shown).

## Constraints

- Data derives from per-match mental flags on stored records: the quick-log modal's `GameRecord.mental` and the Review screen's `GameRecord.review.flags`, OR-merged per flag.
- Composite formula: `tilted = tilt-flag share`; `calm = 0.5·(1 − tiltShare) + 0.5·positiveCommsShare` — two deliberately independent axes.
- All cost/trend/session/trigger derivations live in pure, Electron-free `src/core/mentalAnalytics.ts` with unit tests; the view only formats and gates on `COST_MIN_SAMPLE`. Payload fields (`mentalCosts`, `tiltTrend`, `tiltBySession`, `tiltByTimeOfDay`, `tiltAfterResult`, `tiltByMap`) ride the typed IPC contract. Draws never count toward a decided sample.
- **Break reminder** (`src/core/breakReminder.ts`, pure): given the current loss streak, settings, and prior fire-state, it fires at the configured threshold and re-fires every further `afterLosses` losses, and re-arms as soon as the streak stops being a loss streak. The main process evaluates it after every recorded game — from **both** ingestion paths (live GEP feed and the manual Log Match modal) — against the **unfiltered** history. Firing sends a Windows tray toast ("Time for a break?" / "That's N losses in a row…"). Settings: `enabled` + `afterLosses` (UI offers 1–5, core clamps 1–10, default `{ enabled: true, afterLosses: 2 }`), persisted to `config.local.json`, editable from this card and from Settings through the same component.
- Reminder fire-state is held **in-memory only** in the main process — an app restart re-arms it (an accepted trade-off).
