# Screen spec: Logs (`logs`)

**Source:** `renderer/src/views/logViewer.ts`, `src/core/logging.ts`, `src/main/logger.ts`, `renderer/src/components/logLevelToggle.ts` · reverse-engineered 2026-07-04 after the ui-qol / live-status / debug-log batch (PR #8)
**Provenance tags:** [explicit] stated in code/comments · [inferred] reconstructed from behavior · [spec] intent from `debug-log.spec.md` (2026-07-04)

**Shared context:** Sidebar entry under the **Data** group; also reachable from the Settings Diagnostics card and the command palette (Screen entry). Renders independently of the `DashboardData` snapshot and the global filter bar — its feed is the main process's log ring over the typed IPC contract.

## Intent (WHAT & WHY)

[spec] When live tracking misbehaves in the field ("it says connected but nothing updates"), the release build must be diagnosable *inside the app*: a read-only live tail of the always-on rotating log, with level filtering and pause — no console, no file spelunking, no special build.

## In-Scope

- **Live tail:** [explicit] one snapshot pull of the main process's entry ring (`getLogEntries`), then per-entry pushes (`onLogEntry`) appended live. The subscription is a module singleton: it outlives view re-renders, entries keep accumulating while other screens are active, and the renderer-side ring is bounded to the same cap as main's (`LOG_RING_CAP = 1000`; the header says "last 1000 entries").
- **Display filter:** [explicit] segmented control All / Info+ / Warn+ / Errors — a renderer-side view filter over what is shown (it does not change what the main process captures). Defaults to All.
- **Capture-level toggle:** the shared `logLevelToggle` (same component as Settings) switching the main logger between `info` and `debug` for this session.
- **Pause / Follow:** [explicit] "⏸ Pause" stops auto-scrolling while entries keep arriving (nothing is lost); "▶ Follow" resumes the tail and jumps to the newest line. New lines matching the filter append even while another filter interaction is pending.
- **Line rendering:** [explicit] read-only, monospace, level-tinted lines in the stable grep-friendly `formatLogLine` shape (`ISO-timestamp level scope message key=value…`); an empty ring renders "No log entries yet."

## Out-of-Scope

- Log upload, crash reporting, or any automatic transmission — [spec] logs never leave the device; sharing is manual (user copies text / grabs the file).
- An "open logs folder" shortcut ([spec] considered, not selected).
- Editing/clearing log entries from the UI; renderer `console.log` mirroring (only errors/unhandled rejections are forwarded into the log — see `screen-shell.spec.md`).

## Constraints

- [explicit] The renderer never touches the log *file* — it reads the in-memory ring over IPC only (no fs access in the renderer; guardrail #4 stays intact, and the viewer works identically in release builds and the preview's mock feed).
- [spec] The file log behind the ring: always on in release, rotating at 2 MB per file × 5 files kept (`MAX_FILE_BYTES`, `MAX_FILES` — constants, adjustable in code), default level `info`, `debug` resets to `info` on restart, written under `userData/logs/`.
- [spec] Redaction is upstream and guaranteed: Notion tokens / credential-shaped values never appear at any level; Notion page/database titles are not logged (ids are fine). Formatting/redaction logic is pure and unit-tested (`src/core/logging.ts`).
- [spec] Logging is failure-proof — a disk-full/locked-file condition degrades logging silently and never crashes or blocks the app; the viewer just shows whatever the ring holds.
- [inferred] Filter choice, pause state, and accumulated entries persist across view switches within a session (module singletons), reset on app relaunch.

## Acceptance Criteria (current behavior)

- Given the app has been running, when Logs opens, then the ring's entries render oldest-to-newest and the view is scrolled to the tail with Follow on.
- Given Follow is on, when new lines are written by the main process, then they appear without manual refresh and the view stays pinned to the tail.
- Given Pause is clicked, then auto-scroll stops while new lines keep appending; clicking Follow resumes and jumps to the newest line — nothing was lost in between.
- Given the filter is set to Errors, then only `error` lines are visible; switching back to All restores every retained line.
- Given the capture level is `info` (default), then no `debug` lines exist to show at any filter setting; flipping the toggle to `debug` makes subsequent GEP event summaries appear.
- Given more than 1000 entries have been written this session, then only the most recent 1000 are retained and shown (oldest evicted first).
- Given a fresh launch with an empty ring, then "No log entries yet." renders instead of an empty pane.

## Known gaps (intent ≠ code)

None identified — behavior matches the `debug-log.spec.md` intent for the viewer. Two notes for precision:

- [inferred] **The viewer tails the session ring, not the file.** Entries from *previous* runs live only in the rotated files on disk; the in-app viewer starts each session empty. This matches the spec's "shows the current log … follows new lines live" reading, but a user hunting yesterday's failure still needs the file.
- [spec] The open question in `debug-log.spec.md` (full sidebar screen vs a panel inside Settings) was resolved in favor of the full **Data → Logs** screen, with Settings linking to it.

## Open Questions

None.
