# Tasks: About screen (`about-page`)

From [`about-page.plan.md`](about-page.plan.md) / [`about-page.spec.md`](about-page.spec.md).
Ordered dependencies-first. Each task is independently reviewable and must leave `npm test` +
`npm run typecheck` green.

- [x] **T1 — Widen `AppInfo` and populate it everywhere it is constructed.**
  - **Goal:** `getAppInfo()` returns build/runtime facts, not just `{ version, supportEmail }`.
  - **Files:** `src/shared/contract/appSettings.ts` (extend interface), `src/main/index.ts`
    (`appInfo()` factory → `app.getVersion()`, `process.versions.*`, `process.platform`,
    `os.release()`, `app.isPackaged`), `renderer/preview/preview.ts` (extend the `getAppInfo` stub
    with placeholder build fields).
  - **Check:** `npm run typecheck` clean (every `AppInfo` constructor supplies the new fields); the
    running app / preview returns the richer object.
  - **Size:** S · **Covers:** AC 3, AC 4, AC 11 (data half).

- [x] **T2 — Pure `core/about.ts`: rows + diagnostics formatter (+ tests).**
  - **Goal:** One pure source for the on-screen rows and the copyable diagnostics string.
  - **Files:** `src/core/about.ts` (`AboutRow`, `buildAboutRows`, `formatDiagnostics`),
    `test/about.test.ts`.
  - **Check:** `npm test` — row order/labels asserted; `formatDiagnostics` deterministic and contains
    version + every build field; `packaged` maps to a human "Dev/Installed" value.
  - **Size:** S · **Covers:** AC 4, AC 5. Depends: T1 (uses `AppInfo` shape).

- [x] **T3 — Pure `core/externalLink.ts`: scheme allowlist (+ tests).**
  - **Goal:** `isAllowedExternalUrl(url)` returns true only for `mailto:` / `https:`.
  - **Files:** `src/core/externalLink.ts`, `test/externalLink.test.ts`.
  - **Check:** `npm test` — true for mailto/https, false for `file:`, `javascript:`, `http:`, junk,
    empty.
  - **Size:** S · **Covers:** AC 8 (core half).

- [x] **T4 — `openExternal` contract + main plumbing (+ provider test).**
  - **Goal:** A renderer can request a maintainer URL be opened via the sanctioned
    `shell.openExternal`, with a scheme guard.
  - **Files:** `src/shared/contract/api.ts` (`openExternal` on `OwStatsApi` + `IPC_CHANNELS`),
    `src/main/dashboard/provider.ts` + `src/main/dataProvider.ts` (`openExternal` on interface +
    `DataProviderDeps`; validate-then-delegate via `isAllowedExternalUrl`), `src/main/index.ts`
    (`openExternal: (url) => shell.openExternal(url)` dep), `src/main/dashboard/ipcHandlers.ts`
    (register the channel), `test/openExternal.test.ts` (fake shell + appInfo deps).
  - **Check:** `npm run typecheck` clean (bridge + preload auto-derive); test asserts allowed URL →
    dep called, disallowed → dep **not** called.
  - **Size:** M · **Covers:** AC 7, AC 8. Depends: T3.

- [x] **T5 — About view (`renderer/src/views/about.ts`).**
  - **Goal:** The screen itself: identity + version, promises, build/runtime rows + Copy diagnostics,
    support/legal + convenience links.
  - **Files:** `renderer/src/views/about.ts` (new; composes `components/primitives` + `viewHead`,
    fetches `bridge.getAppInfo()`, `navigator.clipboard.writeText(formatDiagnostics(info))` + `toast`,
    support button → `bridge.openExternal('mailto:'+email)`, links → `ctx.navigate`/`store.setView`).
  - **Check:** In `npm run preview`, the screen renders from the stub with no console errors; Copy
    diagnostics copies + toasts; links navigate; promises + version visible.
  - **Size:** M · **Covers:** AC 3, AC 4, AC 5, AC 6, AC 7, AC 10, AC 11 (view half). Depends: T1,T2,T4.

- [x] **T6 — Register the view in navigation.**
  - **Goal:** About is a first-class routable screen in the sidebar + palette, restored on relaunch,
    filter-bar-suppressed.
  - **Files:** `renderer/src/store.ts` (`ViewId` union + `initialView()` valid list),
    `renderer/src/app/shell.ts` (import `about`, add to `VIEWS`, add `{ id:'about', label:'About' }`
    to the **App** nav group, add `'about'` to `FILTERLESS_VIEWS`).
  - **Check:** Preview — About shows in the sidebar App group next to Settings and in Ctrl+K; clicking
    activates + highlights it; no global filter bar; relaunch (persisted `view`) reopens About.
  - **Size:** S · **Covers:** AC 1, AC 2. Depends: T5.

- [x] **T7 — Single-source identity: Settings → About link.**
  - **Goal:** Remove the duplicated version one-liner; point Settings at the About screen.
  - **Files:** `renderer/src/views/settings.ts` (`diagnosticsCard` — replace the
    `getAppInfo().then(... 'Vantage <version> · support …')` line with an "About Vantage →" button →
    `store.setView('about')`).
  - **Check:** Preview — Settings → Diagnostics shows the link, not the version string; clicking opens
    About.
  - **Size:** S · **Covers:** AC 9. Depends: T6.

- [x] **T8 — Docs.**
  - **Goal:** User-visible surface documented.
  - **Files:** `README.md` (and the `docs/`/screens list if maintained) — add the About screen.
  - **Check:** Docs list the About screen; `npm test` + `npm run typecheck` still green.
  - **Size:** S · **Covers:** AC 12 (docs half).

## Consistency check (spec ↔ tasks)

Every acceptance criterion maps to at least one task:

| AC | Tasks |
|----|-------|
| 1 — sidebar item | T6 |
| 2 — palette + relaunch | T6 |
| 3 — version prominent | T1 (data), T5 (render) |
| 4 — build/runtime rows | T1 (data), T2 (rows), T5 (render) |
| 5 — copy diagnostics | T2 (formatter), T5 (button) |
| 6 — safety/privacy promises | T5 |
| 7 — support link opens safely | T4 (openExternal), T5 (button) |
| 8 — reject unsafe schemes | T3 (allowlist), T4 (provider guard) |
| 9 — Settings single-sources identity | T7 |
| 10 — convenience links navigate | T5 |
| 11 — renders in preview | T1 (stub), T5 (view) |
| 12 — Definition of Done | T2/T3/T4 (tests), T8 (docs), all (test+typecheck) |

- **Gaps (AC with no task):** none.
- **Scope creep (task with no AC):** none — every task traces to at least one AC. (T8 → AC 12 docs.)
- **Deferred by design (not in tasks, per spec Out-of-Scope / Open Questions):** updater, changelog,
  telemetry, repo/homepage links, third-party credits. Any of these would need a `/revise` first.
