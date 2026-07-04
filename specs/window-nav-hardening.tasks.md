# Breakdown: window-nav-hardening

Small change, single bottom-up pass. Checkboxes track the autonomous implementation run.

## T1 — Policy helper + test
- [x] `src/main/dashboard/webContentsSecurity.ts` (NEW): `hardenWebContents(contents)` — deny
      popups (`setWindowOpenHandler`), block `will-navigate` + `will-redirect`. Type-only Electron
      import.
- [x] `test/webContentsSecurity.test.ts` (NEW): fake `WebContents`; assert deny action (H1),
      `will-navigate` prevented (H2), `will-redirect` prevented (H3), both channels registered.
- Proves: H1, H2, H3. ✅ 4/4 tests pass.

## T2 — Wire into the window
- [x] `src/main/dashboard/dashboardWindow.ts`: import `hardenWebContents`; add
      `sandbox: true` to `webPreferences`; call `hardenWebContents(this.win.webContents)` after
      creation, before `loadFile`.
- Proves: H4 (own load unaffected), H5 (sandbox explicit). Depends: T1.

## T3 — Docs + full verify
- [x] `README.md` Account-safety: one-line shell-hardening note.
- [x] `npm run typecheck` (main + renderer) clean.
- [x] `npm test` green (new test included) — 26 files, 202 tests.
- [x] `npm run build` clean (preload bundle intact — 2.5 kb).
- Proves: H6 (external links unaffected — no code path changed), X1–X6.
