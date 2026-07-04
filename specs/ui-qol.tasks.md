# Tasks: UI quality-of-life batch (`ui-qol`)

Source: `specs/ui-qol.plan.md`. Land order: third. Phases A–F (P1) → G (P2) → H (P3).

- [x] A1 prefs.ts (typed localStorage facade)
- [x] A2 components/toast.ts (+ shell mount, styles, aria-live)
- [x] A3 store/shell refresh model: refreshing/stale states, skip-rerender, busy dot, error card + retry, components/skeleton.ts
- [x] A4 shortcuts.ts registry (+ cheatsheet overlay, Esc-back, Ctrl+1..9)
- [x] B1 fuzzy.ts + app/palette.ts (screens/actions/data), titlebar hookup, ViewParams.highlight + maps highlight
- [x] C1 src/core/heroes.ts (+ fixtures stay frozen subset + test) ; components/typeahead.ts ; log-match prefill from prefs + empty flags
- [x] D1 view restore (#4), :focus-visible + reduced-motion (#5), status text ticker (#6)
- [x] E1 undo toasts: archive target, review save (clearReview IPC + store), settings changes; delete keeps confirm
- [x] F1 views/settings.ts + NAV App group; breakReminderEditor extraction; AppConfig.ui + getAppSettings/setAppSettings/getAppInfo; close-to-tray branch; window bounds memory
- [x] G1 empty states w/ actions (totalGamesAllTime), filter reset chip
- [x] G2 matchDetail prev/next + cross-links in matches rows
- [x] G3 day grouping (core groupByDay + test) in matches
- [x] G4 heroes table: sort persistence (table persistSortAs), sticky header, min-games toggle
- [x] G5 review keyboard grading (H/P/M/S) + auto-advance
- [x] G6 charts/tooltip.ts → lineChart wrapper, horizontalBars, heatmap
- [x] G7 Notion sync progress push + lastSyncedAt
- [x] H1 filter presets
- [x] H2 scroll memory
- [x] H3 session recap (core sessionRecap + test, overview card)
- [x] H4 colorblind palette toggle
- [x] H5 chart-as-table (chartCard on Trends line + Maps bars)
- [x] Z1 Docs: README updated; screen-spec refresh flagged as follow-up; final green: npm test + typecheck + build
