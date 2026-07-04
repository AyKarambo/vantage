# Tasks: UI quality-of-life batch (`ui-qol`)

Source: `specs/ui-qol.plan.md`. Land order: third. Phases A–F (P1) → G (P2) → H (P3).

- [ ] A1 prefs.ts (typed localStorage facade)
- [ ] A2 components/toast.ts (+ shell mount, styles, aria-live)
- [ ] A3 store/shell refresh model: refreshing/stale states, skip-rerender, busy dot, error card + retry, components/skeleton.ts
- [ ] A4 shortcuts.ts registry (+ cheatsheet overlay, Esc-back, Ctrl+1..9)
- [ ] B1 fuzzy.ts + app/palette.ts (screens/actions/data), titlebar hookup, ViewParams.highlight + maps highlight
- [ ] C1 src/core/heroes.ts (+ fixtures reuse + test) ; components/typeahead.ts ; log-match prefill from prefs + empty flags
- [ ] D1 view restore (#4), :focus-visible + reduced-motion (#5), status text ticker (#6)
- [ ] E1 undo toasts: archive target, review save (clearReview IPC + store), settings changes; delete keeps confirm
- [ ] F1 views/settings.ts + NAV App group; breakReminderEditor extraction; AppConfig.ui + getAppSettings/setAppSettings/getAppInfo; close-to-tray branch; window bounds memory
- [ ] G1 empty states w/ actions (totalGamesAllTime), filter reset chip
- [ ] G2 matchDetail prev/next + cross-links in matches rows
- [ ] G3 day grouping (core groupByDay + test) in matches
- [ ] G4 heroes table: sort persistence (table storageKey), sticky header, min-games toggle
- [ ] G5 review keyboard grading + auto-advance
- [ ] G6 charts/tooltip.ts extraction → lineChart wrapper, horizontalBars, heatmap
- [ ] G7 Notion sync progress push + lastSyncedAt
- [ ] H1 filter presets
- [ ] H2 scroll memory
- [ ] H3 session recap (core sessionRecap + test, overview card)
- [ ] H4 colorblind palette toggle
- [ ] H5 chart-as-table (chartCard)
- [ ] Z1 Docs: README + affected screen specs updated; final green: npm test + typecheck + build
