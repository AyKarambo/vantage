# Tasks: Live connection & data-flow status (`live-status`)

Source: `specs/live-status.plan.md`. Land order: second (after debug-log).

- [x] T1 Core: `src/core/gepHealth.ts` (GepHealthTrack, reduceGepSignal, gepHealth, STALE_AFTER_MS) + export isMatchStart/isMatchEnd from matchAggregator + `test/gepHealth.test.ts`
- [x] T2 Monitor: `src/main/gepStatusMonitor.ts` (track, 15s tick, change detection, publish/log)
- [x] T3 Contract: `src/shared/contract/gepStatus.ts`, getGepStatus invoke, EVENT_CHANNELS.gepStatus + onGepStatus
- [x] T4 Tray: icon variants in make-tray-icon.mjs, TrayController.setHealth (setImage + tooltip)
- [x] T5 Wiring: index.ts GEP branch feeds monitor; publish → dashboard.push + tray.setHealth; provider/ipcHandlers getGepStatus
- [x] T6 Renderer: `gepStatus.ts` mini-store, `components/popover.ts`, status bar dot states + label + click popover, styles
- [x] T7 Preview scenario mocks (?gep= param)
- [x] T8 Docs: README status semantics; green: npm test + typecheck
