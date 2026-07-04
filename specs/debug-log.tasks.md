# Tasks: Release debug log (`debug-log`)

Source: `specs/debug-log.plan.md`. Land order: this stream first.

- [x] T1 Core log model: `src/core/logging.ts` (levels, LogEntry, formatLogLine, redactSecrets, ring helpers) + `test/logging.test.ts`
- [x] T2 Logger edge: `src/main/logger.ts` (rotating file, ring, level, onEntry hook, degraded mode, injectable fs) + `test/logger.test.ts`
- [x] T3 Contract: `src/shared/contract/logging.ts`, api.ts (4 invoke methods + channels, EVENT_CHANNELS + onLogEntry), index.ts re-exports
- [x] T4 Edges: preload event forwarders (generated), dashboardWindow.push(), provider members, ipcHandlers registrations, dataProvider implementations
- [x] T5 Composition root: create logger first; thread into pipeline/GEP/screenshots/Notion/replay; process-level uncaught handlers; renderer error forwarding (renderer/src/main.ts)
- [x] T6 Renderer: bridge event members, `components/logLevelToggle.ts`, `views/logViewer.ts`, shell NAV (Data → Logs) + VIEWS, styles
- [x] T7 Preview mocks (getLogEntries, onLogEntry fake feed, get/setLogLevel)
- [x] T8 Docs: README logging section; green: npm test + typecheck
