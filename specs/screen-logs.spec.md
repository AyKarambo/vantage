# Screen spec: Logs (`logs`)

**Source:** `renderer/src/views/logViewer.ts`, `src/core/logging.ts`, `src/main/logger.ts`, `renderer/src/components/logLevelToggle.ts`.

**Shared context:** Sidebar entry under the **Data** group; also reachable from the Settings Diagnostics card and the command palette (Screen entry). Renders independently of the `DashboardData` snapshot and the global filter bar — its feed is the main process's log ring over the typed IPC contract.

## Intent

When live tracking misbehaves in the field ("it says connected but nothing updates"), the release build must be diagnosable *inside the app*: a read-only live tail of the always-on rotating log, with level filtering and pause — no console, no file spelunking, no special build.

## Layout & behaviour

- **Live tail:** one snapshot pull of the main process's entry ring (`getLogEntries`), then per-entry pushes (`onLogEntry`) appended live. The subscription is a module singleton — it outlives view re-renders, entries keep accumulating while other screens are active, and the renderer-side ring is bounded to the same cap as main's (`LOG_RING_CAP = 1000`; the header says "last 1000 entries").
- **Display filter:** a segmented control All / Info+ / Warn+ / Errors — a renderer-side view filter over what is shown (it does not change what the main process captures). Defaults to All.
- **Capture-level toggle:** the shared `logLevelToggle` (same component as Settings) switching the main logger between `info` and `debug` for this session.
- **Pause / Follow:** "⏸ Pause" stops auto-scrolling while entries keep arriving (nothing is lost); "▶ Follow" resumes the tail and jumps to the newest line.
- **Line rendering:** read-only, monospace, level-tinted lines in the stable grep-friendly `formatLogLine` shape (`ISO-timestamp level scope message key=value…`); an empty ring renders "No log entries yet."

## Out-of-Scope

- Log upload, crash reporting, or any automatic transmission — logs never leave the device; sharing is manual (copy text / grab the file).
- An "open logs folder" shortcut.
- Editing/clearing log entries from the UI; renderer `console.log` mirroring (only errors/unhandled rejections are forwarded into the log — see `screen-shell.spec.md`).

## Constraints

- The renderer never touches the log *file* — it reads the in-memory ring over IPC only (no fs access in the renderer; guardrail #4). The viewer works identically in release builds and the preview's mock feed, and tails the **session** ring — entries from previous runs live only in the rotated files on disk.
- The file log behind the ring: always on in release, rotating at 2 MB per file × 5 files (`MAX_FILE_BYTES`, `MAX_FILES`), default level `info` (`debug` resets to `info` on restart), written under `userData/logs/`.
- Redaction is upstream and guaranteed: Notion tokens / credential-shaped values never appear at any level; Notion page/database titles are not logged (ids are fine). Formatting/redaction logic is pure and unit-tested (`src/core/logging.ts`).
- Logging is failure-proof — a disk-full/locked-file condition degrades logging silently and never crashes or blocks the app; the viewer shows whatever the ring holds.
- Filter choice, pause state, and accumulated entries persist across view switches within a session (module singletons), reset on app relaunch.
