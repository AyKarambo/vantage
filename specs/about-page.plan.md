# Technical plan: About screen (`about-page`)

Derives from [`about-page.spec.md`](about-page.spec.md). Grounded in the current architecture:
the IPC contract is barreled through `shared/contract`, and **both** the preload
([preload.ts](../src/main/preload.ts)) and the renderer bridge ([bridge.ts](../renderer/src/bridge.ts))
are *auto-derived* from `IPC_CHANNELS`/`EVENT_CHANNELS` — so a new API method needs **no** edit to
either; only the contract, the main handler, the provider, and the composition root change.

## Architecture & Approach

Four layers, edges-only for anything Electron:

1. **Contract (`src/shared/contract`).**
   - Widen `AppInfo` ([appSettings.ts](../src/shared/contract/appSettings.ts)) from `{ version,
     supportEmail }` to also carry the build/runtime facts. Keep it a flat, serializable, `any`-free
     interface.
   - Add one method to `OwStatsApi` ([api.ts](../src/shared/contract/api.ts)):
     `openExternal(url: string): Promise<void>`, plus its entry in `IPC_CHANNELS`
     (`openExternal: 'app:open-external'`). The `satisfies Record<Exclude<keyof OwStatsApi, …>, string>`
     invariant then forces the channel to exist — compile-time safety.

2. **Pure core (`src/core`) — unit-tested, Electron-free.**
   - `src/core/about.ts`: the single source of the About data shape and its text rendering.
     - `interface AboutRow { label: string; value: string }`
     - `buildAboutRows(info: AppInfo): AboutRow[]` — the ordered label/value rows (App version,
       Electron/ow-electron, Chromium, Node, V8, Platform, OS, Build type). Consumed by **both** the
       on-screen rows and the copy string, so they can never drift.
     - `formatDiagnostics(info: AppInfo): string` — the clipboard block: a `Vantage` header line
       plus `buildAboutRows` as aligned `label: value` lines. Deterministic (no clock/env reads).
   - `src/core/externalLink.ts`: `isAllowedExternalUrl(url: string): boolean` — parses the URL and
     returns true only for an allowlisted scheme (`mailto:`, `https:`). The security primitive behind
     AC 8, unit-testable with plain strings, reusable beyond About.

3. **Main edge (`src/main`).**
   - **Composition root** ([index.ts](../src/main/index.ts)): expand the `appInfo()` factory to
     populate the new fields — `version: app.getVersion()`, `electron/chromium/node/v8` from
     `process.versions`, `platform: process.platform`, `osRelease: os.release()`,
     `packaged: app.isPackaged`. Add an `openExternal(url)` dep: `(url) => shell.openExternal(url)`
     (`shell` is already imported here for the tray handlers).
   - **DataProvider** ([dataProvider.ts](../src/main/dataProvider.ts) + `provider.ts`): add
     `openExternal(url): Promise<void>` to the `DataProvider` interface and `DataProviderDeps`.
     Implementation is *validate-then-delegate*: `if (!isAllowedExternalUrl(url)) return;` (no-op on a
     disallowed scheme — never reaches the shell) else `await deps.openExternal(url)`. `getAppInfo`
     is unchanged (`() => deps.appInfo()`) — it just returns the now-richer object.
   - **IPC registration** ([ipcHandlers.ts](../src/main/dashboard/ipcHandlers.ts)): one line —
     `handle(ch.openExternal, (_e, url: string) => provider.openExternal(url));`. The `handle`
     wrapper already rejects untrusted senders, so no extra guard is needed there.

4. **Renderer (`renderer/src`).**
   - **New view** `renderer/src/views/about.ts`: `export function about(ctx: ViewContext):
     HTMLElement`, composed from `components/primitives` (`card`, `button`, `pill`/`chip`) and
     `viewHead`, exactly like [readiness.ts](../renderer/src/views/readiness.ts). Layout:
     - **Identity card** — brand mark (reuse the sidebar `.brand-mark` element) + "Vantage" +
       tagline + prominent `Version <version>`.
     - **Promise card(s)** — account-safe (GEP-only, zero ban risk) and local-first / opt-in Notion,
       in plain prose.
     - **Build & runtime card** — `buildAboutRows(info)` mapped to label/value rows, with a
       **Copy diagnostics** button → `navigator.clipboard.writeText(formatDiagnostics(info))` then
       `toast('Diagnostics copied')`.
     - **Support & legal card** — support email button → `bridge.openExternal('mailto:' + email)`;
       "MIT · © Timo Seikel"; convenience links → `ctx.navigate('settings')` /
       `store.setView('logs')`.
     - `info` is fetched once via `bridge.getAppInfo()` and painted on resolve (same
       fetch-then-`render(host, …)` pattern the Settings cards use); a light "Loading…" placeholder
       until then.
   - **Wiring** — register the view id everywhere the compiler/enum demands:
     - [store.ts](../renderer/src/store.ts): add `'about'` to the `ViewId` union **and** to the
       `initialView()` `valid` array (so it restores on relaunch).
     - [shell.ts](../renderer/src/app/shell.ts): import `about`, add to the `VIEWS` record, add a
       `{ id: 'about', label: 'About', icon: … }` item to the **App** nav group, and add `'about'`
       to `FILTERLESS_VIEWS` (account-agnostic — no global filter bar). The palette nav list is
       derived from `NAV`, so About appears in Ctrl+K automatically.
   - **Settings single-source** ([settings.ts](../renderer/src/views/settings.ts) `diagnosticsCard`):
     drop the `bridge.getAppInfo().then(... 'Vantage <version> · support …')` one-liner; replace with
     a small **"About Vantage →"** button → `store.setView('about')`.
   - **Preview harness** ([preview.ts](../renderer/preview/preview.ts)): extend the `getAppInfo`
     stub with placeholder build fields (`electron: 'preview'`, etc.) and add an `openExternal:
     async () => {}` stub so the browser harness renders and the buttons are inert-but-wired.

## Affected Files/Modules

**Contract**
- `src/shared/contract/appSettings.ts` — widen `AppInfo`.
- `src/shared/contract/api.ts` — `openExternal` on `OwStatsApi` + `IPC_CHANNELS`.

**Core (new + tests)**
- `src/core/about.ts` *(new)* — `AboutRow`, `buildAboutRows`, `formatDiagnostics`.
- `src/core/externalLink.ts` *(new)* — `isAllowedExternalUrl`.
- `test/about.test.ts` *(new)*, `test/externalLink.test.ts` *(new)*.

**Main**
- `src/main/index.ts` — richer `appInfo()`; `openExternal` dep.
- `src/main/dataProvider.ts` + `src/main/dashboard/provider.ts` — `openExternal` on interface + impl.
- `src/main/dashboard/ipcHandlers.ts` — register `openExternal`.

**Renderer**
- `renderer/src/views/about.ts` *(new)*.
- `renderer/src/store.ts` — `ViewId` + `initialView`.
- `renderer/src/app/shell.ts` — `VIEWS`, `NAV`, `FILTERLESS_VIEWS`.
- `renderer/src/views/settings.ts` — diagnostics card link.
- `renderer/preview/preview.ts` — stubs.

**Docs**
- `README.md` / screens list — add the About screen (and `specs/screen-*`-style note if that family
  is maintained).

## Data Model / Interfaces

```ts
// shared/contract/appSettings.ts
export interface AppInfo {
  version: string;
  supportEmail: string;
  /** Runtime build facts, gathered at the main edge (process.versions / os). */
  electron: string;
  chromium: string;
  node: string;
  v8: string;
  platform: string;   // process.platform, e.g. 'win32'
  osRelease: string;  // os.release()
  packaged: boolean;  // app.isPackaged — false in dev/preview
}

// shared/contract/api.ts (OwStatsApi)
/** Open a maintainer-provided external URL via the sanctioned main-process
 *  shell.openExternal path (renderer navigations are hardened off). */
openExternal(url: string): Promise<void>;

// core/about.ts
export interface AboutRow { label: string; value: string }
export function buildAboutRows(info: AppInfo): AboutRow[];
export function formatDiagnostics(info: AppInfo): string;

// core/externalLink.ts
export function isAllowedExternalUrl(url: string): boolean; // mailto: | https:
```

No change to `DashboardData` or the store's `AppState` beyond the `ViewId` union.

## Test Strategy

Acceptance criteria → verification:

- **Pure core (vitest, `test/`)**
  - `buildAboutRows` — given a fully-populated `AppInfo`, returns rows in the expected order with the
    expected labels; `packaged:false` renders a "Dev build" value, `true` renders "Installed". (AC 4.)
  - `formatDiagnostics` — deterministic snapshot: header + one `label: value` line per row; contains
    the version and every build field. (AC 5.)
  - `isAllowedExternalUrl` — true for `mailto:a@b.com` and `https://x.y`; false for `file:///…`,
    `javascript:…`, `http:` (if we decide http is out), garbage, and empty. (AC 8.)
  - Provider-level (with a fake `openExternal` dep + fake `appInfo`): `provider.openExternal` calls
    the dep for an allowed URL and does **not** call it for a disallowed one. (AC 7, 8.)
- **Typecheck** — `npm run typecheck` proves the contract is wired end-to-end (the `satisfies`
  invariant in `api.ts` fails to compile if the channel is missing; the `ViewId`/`VIEWS` record is
  exhaustive). (AC 1, 4, 9, 12.)
- **Preview harness (manual, `npm run preview`)** — drive to About: version + rows render from the
  stub, Copy diagnostics writes to the clipboard + toasts, links navigate, no console errors.
  Verify the Settings diagnostics card now shows the "About Vantage →" link. (AC 2, 3, 5, 6, 9, 10,
  11.) The renderer is DOM-composition only, so this is the behavioral check for the view.
- **`npm test`** green overall. (AC 12.)

## Risks & Alternatives

- **Renderer nav-hardening swallows links (chosen mitigation).** `hardenWebContents`
  `preventDefault`s in-window navigation, so `<a href>` can't open externally. The `openExternal`
  IPC is the sanctioned path (mirrors the tray's existing `shell.openExternal` usage). *Alternative
  rejected:* loosening `will-navigate` for `mailto:` — weakens Guardrail 1 defense-in-depth for a
  cosmetic gain.
- **Scheme allowlist scope.** We allow `mailto:` and `https:` only. `http:` is intentionally excluded
  (no plaintext web). Only *hard-coded maintainer* URLs are ever passed; no user/dynamic input. This
  keeps the surface minimal even though `openExternal` is generic.
- **`AppInfo` widening touches the preview + provider fake.** Every constructor of an `AppInfo`
  (real factory, preview stub, any test fake) must supply the new fields; the compiler will flag each
  omission — a feature, not a risk, but it means touching the preview stub in the same change.
- **Copy path portability.** `navigator.clipboard.writeText` works in the ow-electron renderer and
  the preview browser; no Electron `clipboard` import crosses into the renderer (that stays main-only,
  as in the tray). If a locked-down context ever blocks it, the diagnostics are still visible on
  screen as rows — graceful degradation.
- **Scope creep guard.** Repo/homepage links, changelog, and third-party credits are explicitly
  deferred (spec Open Questions) so this stays a small, reviewable change.
