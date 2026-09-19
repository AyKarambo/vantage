# Screen spec: Logs (`logs`)

**Source:** `renderer/src/views/logViewer.ts`, `src/core/logging.ts`, `src/main/logger.ts`, `renderer/src/components/logLevelToggle.ts`, `renderer/src/views/settings/diagnostics.ts` (the error/warning counter surfacing, W5).

**Shared context:** Sidebar entry under the **Data** group; also reachable from the Settings Diagnostics card and the command palette (Screen entry). Renders independently of the `DashboardData` snapshot and the global filter bar — its feed is the main process's log ring over the typed IPC contract.

## Intent

When live tracking misbehaves in the field ("it says connected but nothing updates"), the release build must be diagnosable *inside the app*: a read-only live tail of the always-on rotating log, with level filtering and pause — no console, no file spelunking, no special build.

## Layout & behaviour

- **Live tail:** the feed subscription starts at **shell mount** (W5), not on the Logs view's first render — `ensureFeed` is called once from `app/shell.ts`, so the error/warning counter (below) reflects the whole session, not just what happened after the player first opened Logs. One snapshot pull of the main process's entry ring (`getLogEntries`), then per-entry pushes (`onLogEntry`) appended live. The subscription is a module singleton — it outlives view re-renders, entries keep accumulating while other screens are active, and the renderer-side ring is bounded to the same cap as main's (`LOG_RING_CAP = 1000`; the header says "last 1000 entries").
- **Header row:** just the capture-level toggle and Pause/Follow — kept deliberately small so the title/subtitle never gets squeezed (a wider toolbar row below holds everything else; cramming all of it into the header once made the subtitle wrap one word per line at normal widths).
- **Toolbar row (W5), wraps freely on its own line:**
  - **Display filter:** a segmented control All / Info+ / Warn+ / Errors — a renderer-side view filter over what is shown (it does not change what the main process captures). Defaults to All. `presetMinLevel` lets another screen (the Diagnostics error pill) open Logs pre-filtered to `error`.
  - **Scope filter:** a select built from the distinct `LogEntry.scope` values seen so far (`gep` / `main` / `notion` / `pipeline` / `renderer` / …) plus "All scopes"; rebuilt only when a genuinely new scope appears (not on every entry — a live GEP burst can push several lines a second, and this is a `<select>` the player may be mid-interaction with). The current scope stays selectable even if it ages out of the ring.
  - **Search:** a case-insensitive substring filter over each entry's full formatted line (`matchesSearch`, `src/core/logging.ts`), so it also matches inside `key=value` fields, not just the message.
  - **Shown count:** "`N` of `M` shown" next to the filters.
  - **UTC / Local time toggle:** swaps every visible timestamp between the file log's own ISO format and `toLocaleTimeString()` (`formatLogLine`'s `localTime` option — the file itself, and every other caller of `formatLogLine`, stay ISO always).
  - **Copy visible:** copies every currently-filtered line (respecting level/scope/search and the UTC/local choice) to the clipboard, with a toast confirming the line count.
  - **Save debug log…:** reuses the same `bridge.exportLogBundle` + toast handling as About's "Save debug log…".
- **Capture-level toggle:** the shared `logLevelToggle` (same component as Settings) switching the main logger between `info` and `debug` for this session.
- **Pause / Follow:** "⏸ Pause" stops auto-scrolling while entries keep arriving (nothing is lost); "▶ Follow" resumes the tail and jumps to the newest line.
- **Line rendering:** read-only, monospace, level-tinted lines in the stable grep-friendly `formatLogLine` shape (`timestamp level scope message key=value…`, ISO or local per the toggle above); no entries matching the active filters renders "No log entries match the current filters."
- **Error/warning counter (W5):** `subscribeLogStats` exposes a running "errors this session" / "warnings this session" count (since the feed started, i.e. since shell mount) to two other surfaces: the Settings Diagnostics card renders it as plain text when clean, or an accent pill ("N errors · M warnings this session") once `errors > 0` — clicking it presets the Logs level filter to `error` and opens Logs. The Logs sidebar item gets the same live dot the Live nav item uses (`.nav-live-dot`) once `errors > 0`; warnings alone never light it (routine, e.g. the startup "notion shape validation skipped" warn).

## Out-of-Scope

- Log upload, crash reporting, or any automatic transmission — logs never leave the device; sharing is manual (copy text / grab the file).
- An "open logs folder" shortcut.
- Editing/clearing log entries from the UI; renderer `console.log` mirroring (only errors/unhandled rejections are forwarded into the log — see `screen-shell.spec.md`).

## Constraints

- The renderer never touches the log *file* — it reads the in-memory ring over IPC only (no fs access in the renderer; guardrail #4). The viewer works identically in release builds and the preview's mock feed, and tails the **session** ring — entries from previous runs live only in the rotated files on disk.
- The file log behind the ring: always on in release, rotating at 2 MB per file × 5 files (`MAX_FILE_BYTES`, `MAX_FILES`), default level `info` (`debug` resets to `info` on restart), written under `userData/logs/`.
- Redaction is upstream and guaranteed: Notion tokens / credential-shaped values never appear at any level; Notion page/database titles are not logged (ids are fine). Formatting/redaction logic is pure and unit-tested (`src/core/logging.ts`).
- Logging is failure-proof — a disk-full/locked-file condition degrades logging silently and never crashes or blocks the app; the viewer shows whatever the ring holds.
- Filter choice (level/scope/search/local-time), pause state, and accumulated entries persist across view switches within a session (module singletons), reset on app relaunch. The error/warning counter is separate module state, also session-scoped.
