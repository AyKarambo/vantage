# Tech Plan: window-nav-hardening

Companion to [`window-nav-hardening.spec.md`](./window-nav-hardening.spec.md). Small, contained
change: one new main-process helper + its wiring + one unit test + a README line. No shared
domain/contract files are touched, so there is no ripple.

## Architecture summary

The dashboard `BrowserWindow` is created and owned by `DashboardWindow.open()`
(`src/main/dashboard/dashboardWindow.ts`). It already sets `contextIsolation: true` and
`nodeIntegration: false`. We add:

1. `webPreferences.sandbox: true` (explicit).
2. A call to a new `hardenWebContents(this.win.webContents)` immediately after window creation,
   before `loadFile()`.

The policy itself lives in a new file so it is unit-testable without spinning up Electron:

- **`src/main/dashboard/webContentsSecurity.ts`** (NEW): `hardenWebContents(contents)` —
  `setWindowOpenHandler(() => ({ action: 'deny' }))`, and `will-navigate` + `will-redirect`
  listeners that `preventDefault()`. Uses **`import type { WebContents }`** (erased at compile
  time → zero runtime Electron dependency, so the module loads fine under vitest/esbuild and pulls
  no Electron into the test).

Why a helper and not inline: the repo already unit-tests main-process modules (`logger.test.ts`,
`matchPipeline.test.ts`) with plain fakes and no mocking library. Extracting the policy lets us do
the same and keeps `dashboardWindow.ts` focused on lifecycle.

### Implementation order

`helper (+ test) → wire into window (+ sandbox) → README → full verify`.

## Changes

### 1. `src/main/dashboard/webContentsSecurity.ts` (NEW)

```ts
import type { WebContents } from 'electron';

/**
 * Locks a webContents to the bundle it loaded: denies popups / new windows and
 * blocks any navigation away from the app. Vantage's dashboard only ever loads
 * its own local bundle and never navigates in-window — external links are opened
 * via shell.openExternal in the composition root — so this is pure defense-in-depth
 * behind Guardrail 1 (account safety). `loadFile`/`loadURL`/reload are programmatic
 * navigations and do NOT emit will-navigate/will-redirect, so the app's own load is
 * unaffected; only in-page navigations (link clicks, window.location, form posts) are.
 *
 * Type-only Electron import → no runtime coupling; unit-testable with a plain fake.
 */
export function hardenWebContents(contents: WebContents): void {
  contents.setWindowOpenHandler(() => ({ action: 'deny' as const }));
  contents.on('will-navigate', (event) => event.preventDefault());
  contents.on('will-redirect', (event) => event.preventDefault());
}
```

### 2. `src/main/dashboard/dashboardWindow.ts`

- Import: `import { hardenWebContents } from './webContentsSecurity';`
- `webPreferences`: add `sandbox: true` (alongside `contextIsolation: true`, `nodeIntegration: false`).
- Immediately after `this.win = new BrowserWindow({...})` and before `this.win.loadFile(...)`:
  `hardenWebContents(this.win.webContents);`

### 3. `test/webContentsSecurity.test.ts` (NEW)

A synchronous, dependency-free fake `WebContents` that records the open handler and the
`will-navigate`/`will-redirect` listeners, then asserts the policy. Proves H1, H2, H3.

- `setWindowOpenHandler(h)` → store `h`; test invokes it and expects `{ action: 'deny' }`.
- `on(channel, listener)` → store per channel; test emits a fake event with a `preventDefault`
  spy and expects it called for both `will-navigate` and `will-redirect`.
- Also assert `on` was called for **both** channels (no silent omission).

### 4. `README.md` — Account safety

Add one sentence: the desktop shell itself is hardened — context isolation, sandboxed renderer, a
strict CSP, and no in-window navigation or popups — so the renderer stays a contained surface.

## Gotchas (thought through up front)

1. **Do not block the initial load.** `will-navigate`/`will-redirect` are **not** emitted for
   `loadFile`/`loadURL`/`reload` (programmatic). Verified against the Electron docs. Deny-all is
   therefore safe — H4. If a future change relies on in-page navigation, this must be revisited.
2. **`setWindowOpenHandler` return type.** Return `{ action: 'deny' as const }` so the literal
   type matches `WindowOpenHandlerResponse` regardless of inference context (avoids `string`
   widening).
3. **`import type`, not `import`.** A value import of `electron` here would make the module pull
   Electron at runtime and break the vitest import (no Electron in the test env). Type-only import
   is erased — confirmed the module has no other Electron value usage.
4. **`sandbox: true` is not a behavior change.** The preload is already sandboxed (bundled per
   `0b59709`) and only uses `contextBridge`/`ipcRenderer`. Making it explicit is documentation +
   future-proofing, not a functional change. Full `npm run build` verifies the preload bundle.
5. **No contract/core/renderer edits.** Nothing crosses the IPC boundary; `src/core/` is not
   touched (helper is under `src/main/`, the Electron edge — Guardrail 3 intact).
6. **Test lives in `test/` (excluded from `tsconfig.json`).** vitest transpiles via esbuild and
   strips the type-only import + `as unknown as WebContents` cast, so no Electron load at test time.

## Addendum (post-research): IPC sender validation

### 5. `src/main/dashboard/webContentsSecurity.ts` (extend)

Two pure predicates (structural event type → no runtime Electron import, unit-testable):

```ts
export function isTrustedSenderUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'file:' && /\/renderer\/index\.html$/i.test(u.pathname);
  } catch { return false; }
}
export function isTrustedIpcEvent(event: { senderFrame: { url: string } | null }): boolean {
  return event.senderFrame != null && isTrustedSenderUrl(event.senderFrame.url);
}
```

### 6. `src/main/dashboard/ipcHandlers.ts` (wrap once, not 30 edits)

Add local `handle`/`on` wrappers that validate the sender, then swap the ~30 `ipcMain.handle` /
3 `ipcMain.on` call sites to them. The wrappers call **bound** `rawHandle`/`rawOn`
(`ipcMain.handle.bind(ipcMain)`) so the mechanical `ipcMain.handle(` → `handle(` replace can't
recurse into the wrapper bodies. `handle` throws on an untrusted sender (the renderer's invoke
rejects); `on` silently drops. Signatures mirror Electron's own (`...args: any[]`) so every typed
call site is unchanged.

### 7. `test/webContentsSecurity.test.ts` (extend) + docs

Cover `isTrustedSenderUrl` (dev path, asar path, case-insensitive, remote origin, wrong page,
unrelated file, malformed) and `isTrustedIpcEvent` (trusted, foreign, null frame). Add sender
validation to the architecture doc's security section and the README note.

### Gotchas (sender validation)

7. **Bind before replace.** The wrappers must reference `rawHandle`/`rawOn`, never
   `ipcMain.handle(`/`ipcMain.on(`, or the global find-replace of call sites recurses into them.
8. **`any[]` in the wrapper signature is deliberate** — it mirrors Electron's own `ipcMain.handle`
   type so the existing per-channel typed listeners stay assignable (contravariance would reject
   `unknown[]`). It does not weaken the contract: argument types remain enforced at each call site.
9. **Allowlist must survive packing.** `pathname` ends with `/renderer/index.html` in both dev and
   asar builds; validated in tests for both.
10. **Do NOT add runtime argument schemas** — the research refuted (0-3) the "validate every
    argument against a schema" claim as over-strong for a trusted local renderer. Sender-frame
    validation only.
11. **ow-electron / Overwolf** may create its own webContents (GEP, overlays); those are not the
    dashboard renderer and never call `owstats` handlers, so the allowlist neither blocks nor
    depends on them. (Open question flagged in the research; low practical risk since no remote
    content is loaded into the dashboard.)

## Definition of Done (from the spec)

`npm test` green · `npm run typecheck` clean (main + renderer) · `npm run build` clean (preload
bundle intact) · `hardenWebContents` + `isTrustedSenderUrl`/`isTrustedIpcEvent` unit-tested
(H1–H3, H7–H10) · README + architecture-doc security notes added · no guardrail weakened ·
**no other module refactored** (the review's explicit constraint).
