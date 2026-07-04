# Feature spec: Release debug log (`debug-log`)

**Source:** UI/UX brainstorm + spec interview, 2026-07-04. Approved 2026-07-04.
**Related specs:** `ui-qol.spec.md` (Settings screen hosts the toggle), `live-status.spec.md`
(state transitions are logged).

## Intent (WHAT & WHY)

When live tracking misbehaves in the field ("it says connected but nothing updates"), there is
currently no way to diagnose it in a release build — no console, no file, no history. Vantage gets
an **always-on, privacy-safe, size-capped log** in every build, an **in-app viewer** so problems
can be inspected without leaving the app, and a **runtime debug-level toggle** so a user (or the
developer guiding them) can capture verbose GEP detail for a session without a special build.

## In-Scope

- **Rotating file log, always on (release included):** main process writes structured,
  timestamped, leveled lines to `userData/logs/`; size-capped rotation (default: 2 MB per file,
  5 files kept — constants, adjustable in code).
- **Logged at `info` (default):** app lifecycle (launch/quit, version), GEP lifecycle (package
  ready, attach/detach, errors), live-status state transitions (from `live-status` spec), match
  pipeline milestones (match start/end, record persisted — match ids, no payload dumps), IPC
  handler errors, Notion sync attempts/results (counts + error classes only), config changes,
  unhandled exceptions/rejections from **main and renderer** (renderer errors forwarded over IPC).
- **`debug` level (opt-in toggle):** adds GEP event/info-update summaries (event name + key
  fields) — enough to answer "are events arriving and what do they look like". Toggle lives in the
  Settings screen (`ui-qol` #10); resets to `info` on app restart.
- **In-app log viewer:** a screen that shows the current log, follows new lines live ("tail"),
  supports level filtering and pause/resume; read-only, fed over the typed IPC contract (no fs
  access in the renderer). Reachable via sidebar/Settings and the command palette.
- **Redaction guarantees:** Notion tokens and any credential-shaped values never appear in any log
  line at any level; Notion page/database *titles* are not logged (ids are fine).

## Out-of-Scope

- Log upload, crash reporting, telemetry, or any automatic transmission — logs never leave the
  device (local-first guardrail). Sharing is manual (user copies text/file).
- "Open logs folder" shortcut (considered, not selected — the in-app viewer covers inspection; may
  be added trivially later).
- Renderer console noise capture (`console.log` mirroring) — only errors/unhandled rejections are
  forwarded.
- Log-based analytics or user-facing "health reports".

## Constraints

- Logging must be failure-proof: a logging error (disk full, locked file) must never crash or
  block the app — worst case, logging silently degrades.
- Log writing is async/buffered enough not to affect match-event handling latency.
- Formatting/serialization/redaction logic is pure and unit-tested (`src/core/` or an equally pure
  module); file I/O and IPC stay at the edges.
- Line format is stable and grep-friendly: `ISO-timestamp level scope message key=value…`.
- The viewer obeys CSP (no external assets) and works against the preview harness (mock log feed).

## Acceptance Criteria

- Given a fresh install running a release build, when the app runs, then `userData/logs/` contains
  a current log with launch, GEP, and status-transition entries at `info`.
- Given the log reaches the size cap, then it rotates and never exceeds the max total (files ×
  cap); oldest is deleted first.
- Given the debug toggle is enabled in Settings, then subsequent GEP events produce `debug`
  summaries; after app restart the level is `info` again.
- Given a Notion token is configured and a sync runs (success or failure), then no log line at any
  level contains the token or any substring of it.
- Given the renderer throws an unhandled error, then it appears in the main log with a `renderer`
  scope.
- Given the log viewer is open with "follow" on, when new lines are written, then they appear
  without manual refresh; filtering to `error` hides lower levels; pause stops the tail without
  losing lines.
- Given the disk is full or the log file is locked, then the app continues functioning normally.

## Resolved questions

1. **Always-on in release** — yes, rotating file log at `info` by default.
2. **Access** — in-app live viewer (chosen); "Open logs folder" not selected.
3. **Verbosity control** — runtime debug toggle, session-scoped (resets on restart).
4. **Privacy line** — no tokens/credentials ever; battletags/match ids permitted (already stored
   locally); no automatic transmission.

## Open Questions

- Default rotation numbers (2 MB × 5) — sane defaults; confirm or adjust at plan review.
- Whether the viewer lives as a full sidebar screen under "Data" or a panel inside Settings —
  leaning full screen for usable tailing space.
