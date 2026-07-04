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

## T4 — IPC sender validation (post-research addendum)
- [x] `src/main/dashboard/webContentsSecurity.ts`: add `isTrustedSenderUrl` + `isTrustedIpcEvent`
      (pure, structural event type).
- [x] `src/main/dashboard/ipcHandlers.ts`: local `handle`/`on` wrappers over bound
      `rawHandle`/`rawOn`; swap all ~30 `ipcMain.handle` + 3 `ipcMain.on` call sites.
- [x] `test/webContentsSecurity.test.ts`: sender-URL allowlist (dev/asar/case/remote/wrong-page/
      unrelated/malformed) + event (trusted/foreign/null).
- [x] Docs: architecture security section + README note updated.
- [x] `npm run typecheck` clean · `npm test` green (26 files, 212 tests) · `npm run build` clean.
- Proves: H7, H8, H9, H10. Scope held: sender-frame only, no runtime arg schemas (refuted 0-3).
