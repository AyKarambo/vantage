# Techplan: Release debug log (`debug-log`)

**Source spec:** `specs/debug-log.spec.md` (approved 2026-07-04).
**Sequencing:** lands **first** of the three features (`debug-log` → `live-status` → `ui-qol`): it
builds the logger every other feature logs to **and** the main→renderer push mechanism that
`live-status` and ui-qol's Notion sync progress reuse. All three plans touch the same edge files
(`contract/api.ts`, `preload.ts`, `bridge.ts`, `ipcHandlers.ts`, `provider.ts`, `preview.ts`) —
streams land serially, never concurrently, against these files.

## Architecture & Approach

Three layers, mirroring the repo's break-reminder precedent (pure core → config/main edge →
contract → renderer):

1. **Pure log model — new `src/core/logging.ts`** (Electron-free, fully unit-tested):
   - `LogLevel = 'debug' | 'info' | 'warn' | 'error'` + `levelAtLeast(a, b)` ordering helper.
   - `LogEntry { ts, level, scope, message, fields? }`.
   - `formatLogLine(entry): string` — the stable, grep-friendly format:
     `2026-07-04T18:22:01.123Z info  gep attached game=10844` (ISO ts, padded level, scope,
     message, `key=value` fields; newlines in values escaped to `\n`).
   - `redactSecrets(line, secrets: string[]): string` — replaces every occurrence of each known
     secret with `***`; plus a pattern pass for Notion token shapes (`secret_…`, `ntn_…`) so even
     an unregistered token never survives. Every line passes through this before write/push.
   - `RING_CAP = 1000`, `pushRing(ring, entry)` — bounded ring-buffer helper the viewer reads from.

2. **Logger edge — new `src/main/logger.ts`:** `createLogger(opts)` → `Logger`:
   - `log(level, scope, message, fields?)` + convenience `info/warn/error/debug` and
     `scoped(scope)` child (so `matchPipeline` receives `logger.scoped('pipeline')` through its
     existing `log` dependency — `src/main/matchPipeline.ts` already takes a `log` dep).
   - **File output:** `userData/logs/vantage.log`, `fs.appendFile` fire-and-forget; before each
     append, a size check rotates: `vantage.4.log` deleted, `…3→4`, `…2→3`, `…1→2`,
     `vantage.log→vantage.1.log` (defaults `MAX_FILE_BYTES = 2MB`, `MAX_FILES = 5` — named
     constants per spec). Every fs call is try/caught; on repeated failure the logger flips an
     internal `degraded` flag and stops touching disk while the **ring buffer and push keep
     working** — spec's failure-proof requirement.
   - **Ring buffer + push:** every accepted entry lands in the in-memory ring (cap 1000) and is
     forwarded to an injected `onEntry(entry)` callback — the composition root wires that to the
     dashboard push channel. The in-app viewer never reads the file (no Windows file-lock issues).
   - `setLevel(level)` / `getLevel()` — session-scoped (spec: resets to `info` on restart), so
     **no config change**; below-level entries are dropped before formatting.
   - Secrets: constructed with `getSecrets: () => string[]` — the composition root supplies the
     current Notion token (from `src/main/config/notionToken.ts` state) so redaction always covers
     the live token.
   - Dev mirror: when `!app.isPackaged`, entries also echo to `console.log` (preserves today's
     dev workflow).

3. **Wiring — `src/main/index.ts` (composition root):** create the logger **first** (before
   stores), then:
   - Replace tagged `console.log` call sites: GEP (`gep.on('log')` → `log.info('gep', …)`,
     `index.ts:123`), screenshots (`screenshots.ts:50`), pipeline (`matchPipeline` dep,
     `index.ts:64-71`), replay/simulate (`index.ts:150-168`), Notion errors
     (`notionRuntime` `onError` additionally logs, `index.ts:61`).
   - `process.on('uncaughtException' | 'unhandledRejection')` → `log.error('main', …)` (log, don't
     swallow — rethrow behavior unchanged).
   - Renderer errors: `window.onerror`/`unhandledrejection` handlers in `renderer/src/main.ts`
     call a new `bridge.logRendererError(...)` invoke → `log.error('renderer', …)`.

4. **Push mechanism (built here, reused by live-status):**
   - `src/shared/contract/api.ts` gains `EVENT_CHANNELS = { logEntry: 'push:log-entry' } as const`
     (live-status adds `gepStatus` later) and `OwStatsApi` gains
     `onLogEntry(cb: (e: LogEntry) => void): () => void` (returns unsubscribe).
   - `src/main/preload.ts`: subscription forwarders built from `EVENT_CHANNELS` the same generated
     way invokers are (`ipcRenderer.on(channel, (_e, p) => cb(p))`, unsubscribe removes the
     listener).
   - `DashboardWindow` gains `push(channel, payload)` — no-op when the window is closed/destroyed.
     Renderer pulls the ring snapshot via invoke on mount, then subscribes; nothing is missed
     while the window is closed beyond what the ring already holds.

5. **IPC (invoke):** `getLogEntries(): Promise<LogEntry[]>` (ring snapshot),
   `getLogLevel(): Promise<LogLevel>`, `setLogLevel(level): Promise<LogLevel>`,
   `logRendererError(input): Promise<void>` — four `DataProvider` members + handlers, following
   the existing add-a-method recipe (contract → channel map → provider → handler; preload is
   generated).

6. **Renderer viewer — new `views/logViewer.ts`:** full sidebar screen (spec open question
   resolved: full screen, registered under the **Data** nav group as "Logs") — monospace scroller
   composed from existing primitives:
   - Header: level filter (`segmented`: All/Info/Warn/Error), **Follow** toggle (`button`), Pause
     retains buffered lines (entries keep accumulating in the local array; the DOM stops
     auto-scrolling), and the **debug-level toggle** (`chip`) calling `setLogLevel` — the same
     control the ui-qol Settings screen later reuses (extracted as
     `components/logLevelToggle.ts` so the spec's "toggle lives in Settings" lands with ui-qol
     without duplication).
   - Body: virtual-ish simple list (ring is capped at 1000 — plain DOM list is fine), newest at
     bottom, auto-scroll when following. Level filtering is local state over the local entry array.
   - Data flow: `getLogEntries()` on mount → `onLogEntry` subscription → unsubscribe on view
     teardown (shell re-render replaces the node; the view registers its unsubscribe via a
     `MutationObserver`-free convention: shell calls no teardown today, so the subscription helper
     stores the unsubscribe and re-mounting replaces it — one module-level subscription for the
     viewer, idempotent on re-render).
7. **Preview harness:** `renderer/preview/preview.ts` mocks `getLogEntries` (canned entries),
   `onLogEntry` (interval-driven fake feed), `set/getLogLevel` (module state) — CSP-safe, keeps
   `OwStatsApi` structurally complete so typecheck enforces parity.

**Guardrail audit:** GEP-only (logs *about* GEP, no new data source) · no secrets (redaction is a
tested guarantee; token never written) · core purity (`src/core/logging.ts` has zero Electron
imports) · CSP-friendly (viewer is bundled UI, no remote content) · local-first (file stays in
`userData`, no transmission path exists).

## Affected Files/Modules

**Created:**
- `src/core/logging.ts` — levels, entry type, format, redaction, ring helpers (pure).
- `src/main/logger.ts` — rotating file writer + ring + level + push hook (edge).
- `renderer/src/views/logViewer.ts` — the Logs screen.
- `renderer/src/components/logLevelToggle.ts` — shared debug-toggle control.
- `test/logging.test.ts`, `test/logger.test.ts`.

**Modified:**
- `src/shared/contract/api.ts` — 4 `OwStatsApi` methods, 4 `IPC_CHANNELS` entries, new
  `EVENT_CHANNELS` + `onLogEntry`; `src/shared/contract/index.ts` re-exports;
  new `src/shared/contract/logging.ts` re-exporting the core types (pattern: `MatchMental`).
- `src/main/preload.ts` — generated event-subscription forwarders next to the invoke generator.
- `src/main/dashboard/provider.ts`, `src/main/dashboard/ipcHandlers.ts` — provider members +
  `ipcMain.handle` registrations; `dashboardWindow.ts` — `push()` helper.
- `src/main/dataProvider.ts` — implement the four members against the injected logger.
- `src/main/index.ts` — construct logger first; thread into pipeline/GEP/Notion/replay call
  sites; process-level handlers.
- `src/main/matchPipeline.ts` — no signature change (already takes `log`); call sites enriched.
- `renderer/src/bridge.ts` — `MEMBERS` already derives from `IPC_CHANNELS`; add event members
  (derive from `EVENT_CHANNELS` keys the same way).
- `renderer/src/main.ts` — global error forwarding.
- `renderer/src/app/shell.ts` — NAV: "Logs" item in the Data group; `VIEWS` registry entry.
- `renderer/preview/preview.ts` — mocks.
- `README.md` — logging section (location, rotation, debug toggle).

## Data Model / Interfaces

```ts
// src/core/logging.ts (re-exported through shared/contract)
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export interface LogEntry {
  ts: number;
  level: LogLevel;
  scope: string;                 // 'gep' | 'pipeline' | 'notion' | 'main' | 'renderer' | 'status' | …
  message: string;
  fields?: Record<string, string | number | boolean>;
}
export interface RendererErrorInput { message: string; stack?: string; source?: string }

// src/main/logger.ts
export interface LoggerOptions {
  dir: string;                   // userData/logs
  maxFileBytes?: number;         // default 2 * 1024 * 1024
  maxFiles?: number;             // default 5
  level?: LogLevel;              // default 'info'
  getSecrets?: () => string[];
  onEntry?: (e: LogEntry) => void;
  mirrorToConsole?: boolean;
}

// contract additions
export const EVENT_CHANNELS = { logEntry: 'push:log-entry' } as const;
interface OwStatsApi {
  getLogEntries(): Promise<LogEntry[]>;
  getLogLevel(): Promise<LogLevel>;
  setLogLevel(level: LogLevel): Promise<LogLevel>;
  logRendererError(input: RendererErrorInput): Promise<void>;
  onLogEntry(cb: (e: LogEntry) => void): () => void;
}
```

Log level is **not** persisted (session-scoped per spec) — `AppConfig` unchanged.

## Test Strategy

- `test/logging.test.ts` (pure): format stability (exact line for a fixture entry), field
  serialization + newline escaping, level ordering, redaction (registered secret vanishes at every
  position; `secret_…`/`ntn_…` pattern caught without registration; spec AC "no substring of the
  token" verified by asserting the token's 8-char chunks are absent), ring cap/eviction order.
- `test/logger.test.ts` (temp-dir pattern from `test/outbox.test.ts:8-14`): writes land in the
  file; rotation cascade at a tiny injected `maxFileBytes` (e.g. 200 bytes) keeps ≤ maxFiles and
  total bytes bounded, oldest deleted first; `setLevel('debug')` admits debug entries and back;
  injected failing fs facade (constructor-injected `fsLike`, matching the DI pattern of
  `matchPipeline.test.ts:73-91`) → logger degrades silently, ring/push keep working, no throw.
- Manual: `npm run preview` exercises the viewer (fake feed, filter, pause/follow);
  `OW_SYNC_SIMULATE=1` produces real pipeline entries in the app.
- Renderer viewer itself: untested per repo convention (no DOM harness); logic kept thin over the
  tested ring/level model.

## Risks & Alternatives

- **Hand-rolled logger vs `electron-log`:** dependency would give rotation for free but adds a
  runtime dep against repo convention (charts/renderer are deliberately dependency-free; main has
  a single runtime dep). Rotation-with-rename is ~30 lines and fully testable — hand-rolled wins.
- **Viewer reads ring, not file:** avoids file locks and parse round-trips; trade-off is the
  viewer only shows the last 1000 entries. Acceptable — the file exists for deep/manual digs.
- **Subscription lifecycle in a teardown-less shell:** views don't get unmount hooks today; a
  naive per-render subscribe leaks. Mitigation: module-level single subscription per concern
  (viewer keeps exactly one), reassigned on re-render. Alternative (rejected as bigger surface): add
  a teardown protocol to `ViewRender`.
- **Hot-path cost:** at `info`, per-match volume is trivial; at `debug`, GEP event summaries are
  one line per event — string build only happens after the level gate; ring push is O(1); appends
  are async. If a real session shows pressure, batch appends behind a 250ms flush (noted, not built).
- **`console.log` sweep completeness:** call sites are grep-auditable (`console\.(log|warn|error)`
  under `src/`); the plan replaces main-process sites and leaves renderer console usage alone
  (out of spec scope).
