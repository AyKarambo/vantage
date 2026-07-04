# Techplan: Live connection & data-flow status (`live-status`)

**Source spec:** `specs/live-status.spec.md` (approved 2026-07-04).
**Sequencing:** lands **second** (`debug-log` → `live-status` → `ui-qol`). Depends on `debug-log`
for (a) the logger its state transitions are written to and (b) the `EVENT_CHANNELS` push
mechanism in preload/bridge/dashboardWindow, which this plan only *extends* with one channel.

## Architecture & Approach

Mirror the break-reminder layering exactly (`src/core/breakReminder.ts` is the in-repo precedent
for a pure reducer driven from the main edges).

1. **Pure health model — new `src/core/gepHealth.ts`** (Electron-free, no timers, `now` passed in):
   - A signal reducer and a state derivation, both pure:
     - `reduceGepSignal(t: GepHealthTrack, signal: GepSignal, now: number): GepHealthTrack` —
       folds the raw feed signals (`attached`, `detached`, `event`, `match-start`, `match-end`)
       into a track record `{ attachedAt, lastEventAt, eventsThisSession, matchInProgress }`.
       `match-start`/`match-end` are themselves events (they also bump `lastEventAt`).
     - `gepHealth(t: GepHealthTrack, now: number): GepHealthState` with
       `STALE_AFTER_MS = 60_000`:
       - not attached → `'no-game'`
       - attached ∧ `matchInProgress` ∧ `now − lastEventAt ≥ 60s` → `'stale'`
       - attached ∧ `matchInProgress` (silence < 60s) → `'live'`
       - attached ∧ no match in progress → `'connected'`
       This satisfies every spec AC: match_start is an event, so entering a match immediately
       yields `live`; one event flips `stale → live`; match end decays to `connected`; menus never
       go stale.
   - Match boundary detection reuses the aggregator's own predicates so the two can't drift:
     export `isMatchStart(msg)` / `isMatchEnd(msg)` from `src/core/matchAggregator/aggregator.ts`
     (they exist as internals at lines 31–34/150–158) through the matchAggregator index barrel.

2. **Monitor edge — new `src/main/gepStatusMonitor.ts`:** a small factory
   (`createGepStatusMonitor({ log, publish, now? })`) holding the `GepHealthTrack` + last
   published state:
   - Inputs wired in the composition root (`src/main/index.ts:119-138`, GEP branch): the existing
     `gep.on('status', …)` listener additionally feeds `attached`/`detached` (from
     `GepStatus.gameRunning && enabled`, `src/main/gep.ts:16-20`), and the existing
     `gep.on('message', …)` listener feeds `event` / `match-start` / `match-end` (classified via
     the exported predicates) — the monitor taps the same emitter subscriptions, zero change to
     `GepService` itself.
   - A **15s interval** re-derives `gepHealth(track, Date.now())` — only staleness can change
     without a signal, so the tick exists purely to catch the 60s deadline (worst-case detection
     latency 75s; see Risks). Interval is `unref`'d.
   - On every derived-state **change**: `log.info('status', 'state', { from, to, … })`,
     `publish(payload)` (→ dashboard push + tray update). No-change ticks are silent.
   - **Counterwatch / demo mode:** when `config.sensor !== 'gep'` the monitor is constructed but
     never receives `attached` — permanently `no-game`, satisfying the spec's "demo never shows
     Connected/Live". The payload carries `sensor` so the renderer can word the popover
     ("no live feed" vs "game not running") without inventing states.

3. **Tray mirroring — `src/main/tray.ts` + icon assets:**
   - `scripts/make-tray-icon.mjs` (which already generates `assets/tray.png` via
     `scripts/lib/aurora-canvas.mjs`) additionally emits three variants with a small status dot
     baked into a corner of the 32×32 badge: `tray-connected.png` (accent), `tray-live.png`
     (green), `tray-stale.png` (red). Base `tray.png` = no-game. Bundled automatically
     (`assets/**/*` is already in the electron-builder `files` list).
   - `TrayController` gains `setHealth(state: GepHealthState)`: swaps the image at runtime via
     Electron's `tray.setImage(nativeImage.createFromPath(variantPath))` (guarded: only on
     change), updates the tooltip (`Vantage — receiving data` etc.), and prepends the health line
     to the existing status menu row (the `status` field of `TrayState`, `tray.ts:23-27`).
   - Icon paths resolved next to the existing `iconPath` (`src/main/index.ts:53`).

4. **Contract & push:** one new invoke + one new push channel, following the debug-log mechanism:
   - `getGepStatus(): Promise<GepStatusPayload>` (initial snapshot on renderer mount/focus).
   - `EVENT_CHANNELS.gepStatus: 'push:gep-status'` + `onGepStatus(cb): () => void`.
   - `DataProvider` member backed by the monitor's `current()`.

5. **Renderer — status bar upgrade in `app/shell.ts` + new `components/popover.ts`:**
   - A module-level `gepStatus` mini-store (`renderer/src/gepStatus.ts`): snapshot via
     `bridge.getGepStatus()` at startup and on window focus, subscription via
     `bridge.onGepStatus`, notifies the shell to re-render **only the status bar region** (the
     footer nodes are already long-lived fields on `App`, `shell.ts:69-70` — no full view
     re-render).
   - The `.status-dot` (static green today, `app.css`) gets state classes:
     `is-no-game` (dim), `is-connected` (accent), `is-live` (green), `is-stale` (red + subtle
     pulse; the pulse animation respects ui-qol's `prefers-reduced-motion` rule once that lands).
     Label text next to the dot: "No game" / "Connected — waiting for events" / "Receiving data" /
     "No data for Xs — feed may be stuck" (final wording is a spec open question; these are the
     working strings).
   - Click → anchored **popover** (new lightweight `components/popover.ts`, positioned above the
     footer, z-index 45, Escape/backdrop close reusing the overlay conventions): rows for state,
     last event (`relTime`), events this session, match in progress, attached since. The popover
     re-renders live while open (subscribed to the same mini-store) and its relative times tick
     with the ui-qol 60s ticker (10s here for the stale countdown).
   - In demo/counterwatch (`sensor !== 'gep'`), the label reads "No live feed" and the popover
     explains GEP approval status — never Connected/Live (spec AC).
6. **Preview harness:** `preview.ts` implements `getGepStatus`/`onGepStatus` with a scenario
   driver — `?gep=live|stale|connected|no-game` URL param plus a `window` hook that cycles states
   every few seconds when `?gep=cycle`, satisfying the spec constraint that the preview can
   simulate all four states.

**Guardrail audit:** GEP-only (health derives from event *timing* of the sanctioned feed — no new
data source) · no secrets · core purity (`gepHealth.ts` pure; monitor/tray/push are edges) ·
CSP-friendly (popover is bundled UI) · local-first (health telemetry never leaves the device;
it's not even persisted).

## Affected Files/Modules

**Created:**
- `src/core/gepHealth.ts` — types, `STALE_AFTER_MS`, `reduceGepSignal`, `gepHealth` (pure).
- `src/main/gepStatusMonitor.ts` — track state, 15s tick, change detection, publish/log.
- `renderer/src/gepStatus.ts` — renderer mini-store (snapshot + subscription).
- `renderer/src/components/popover.ts` — anchored popover (reused later by ui-qol).
- `test/gepHealth.test.ts`.

**Modified:**
- `src/core/matchAggregator/aggregator.ts` + its `index.ts` barrel — export
  `isMatchStart`/`isMatchEnd` (pure refactor, no behavior change).
- `src/shared/contract/api.ts` — `getGepStatus` invoke + channel, `EVENT_CHANNELS.gepStatus`,
  `onGepStatus`; new `src/shared/contract/gepStatus.ts` type module; `index.ts` re-exports.
- `src/main/preload.ts` — nothing hand-written (invoke + event forwarders are generated from the
  channel maps built in debug-log).
- `src/main/dashboard/provider.ts` / `ipcHandlers.ts` — `getGepStatus` member + handler.
- `src/main/index.ts` — construct monitor in the GEP branch (lines 119-138); wire
  `publish → dashboard.push + tray.setHealth`; pass logger scope `status`.
- `src/main/tray.ts` — `setHealth()`, variant icon paths, tooltip.
- `scripts/make-tray-icon.mjs` (+ `scripts/lib/aurora-canvas.mjs` if the dot needs a new
  primitive) — emit the three variants.
- `renderer/src/app/shell.ts` — status-bar region render + click-to-popover.
- `renderer/styles/app.css` / `components.css` — dot state classes, pulse keyframes, popover.
- `renderer/src/bridge.ts` — event member derivation already generic after debug-log.
- `renderer/preview/preview.ts` — scenario mocks.
- `README.md` — status indicator semantics (the four states, what Stale means).

## Data Model / Interfaces

```ts
// src/core/gepHealth.ts (re-exported via shared/contract/gepStatus.ts)
export type GepHealthState = 'no-game' | 'connected' | 'live' | 'stale';
export const STALE_AFTER_MS = 60_000;

export interface GepHealthTrack {
  attachedAt: number | null;       // null = not attached
  lastEventAt: number | null;
  eventsThisSession: number;
  matchInProgress: boolean;
}
export type GepSignal =
  | { kind: 'attached' } | { kind: 'detached' }
  | { kind: 'event' } | { kind: 'match-start' } | { kind: 'match-end' };

export function reduceGepSignal(t: GepHealthTrack, s: GepSignal, now: number): GepHealthTrack;
export function gepHealth(t: GepHealthTrack, now: number): GepHealthState;

// src/shared/contract/gepStatus.ts
export interface GepStatusPayload {
  state: GepHealthState;
  sensor: 'gep' | 'counterwatch';
  attachedAt: number | null;
  lastEventAt: number | null;
  eventsThisSession: number;
  matchInProgress: boolean;
  lastError?: string;              // pass-through from GepStatus.lastError
}

// contract additions
interface OwStatsApi {
  getGepStatus(): Promise<GepStatusPayload>;
  onGepStatus(cb: (s: GepStatusPayload) => void): () => void;
}
```

Nothing is persisted — health is entirely session state. `AppConfig` unchanged.

## Test Strategy

`test/gepHealth.test.ts` (pure, `now` passed explicitly — mirrors `test/breakReminder.test.ts`
sequence-fold style):
- Signal folding: attach sets `attachedAt`; every event kind bumps `lastEventAt` + counter;
  match-start/end toggle `matchInProgress`; detach resets the track.
- Derivation table: not attached → `no-game`; attached idle → `connected`; match-start →
  `live` immediately; at `now = lastEventAt + 59_999` → still `live`; at `+60_000` → `stale`;
  one event at `+61s` → `live` again (spec AC: immediate recovery); match-end during stale →
  `connected` (no warning between matches); detach mid-match → `no-game`.
- `STALE_AFTER_MS === 60_000` pinned (spec constant).
- Monitor edge: thin enough to leave untested per repo convention (interval + change-compare);
  its change-detection logic (`derive ≠ lastPublished`) is folded into the pure test via
  derivation-table assertions.
- Manual: `OW_SYNC_REPLAY=<capture>` drives real attach/event/match signals end-to-end (tray +
  status bar + log entries); `npm run preview` with `?gep=stale` etc. verifies all four renderings
  and the popover.

## Risks & Alternatives

- **60s threshold vs real GEP cadence:** the assumption "OW2 emits events at least once a minute
  mid-match" should be verified against an `OW_SYNC_RECORD=1` capture before release. If a real
  capture shows legitimate >60s gaps, bump the constant — one line, pinned by one test. Stale is
  deliberately a *warning*, not an error, to keep false positives cheap.
- **Detection latency (up to 75s):** the 15s tick means the flip can happen 60–75s after the last
  event. Alternative: schedule a precise `setTimeout` at `lastEventAt + 60s` on every event —
  rejected as churny (rearms on every GEP event, potentially many per second at debug-level flow);
  the interval is simpler and the latency is immaterial for a human-facing warning.
- **Tray icon swap frequency:** `tray.setImage` on every state change only; images are loaded once
  and cached in a `Record<GepHealthState, NativeImage>`. If Windows flickers on swap (unlikely at
  this rate), fall back to tooltip+menu-only mirroring and keep a static icon (spec's tray AC
  would need a `/revise` — flagged now).
- **Aggregator predicate reuse:** exporting `isMatchStart/isMatchEnd` couples the monitor to
  aggregator internals *by design* (drift between "pipeline thinks a match is running" and "status
  thinks so" is exactly the class of lie the spec bans). Alternative — the monitor asking the
  aggregator for its in-match flag — was rejected because `MatchAggregator` resets state in
  `finalize()` and exposes no query surface; adding one touches more than exporting two predicates.
- **Missed pushes while window closed:** the renderer re-pulls `getGepStatus()` on open/focus
  (piggybacking the existing focus-refresh, `shell.ts:215`), so the status bar is correct within
  one focus even if every push was dropped.
