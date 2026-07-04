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

## Definition of Done (from the spec)

`npm test` green · `npm run typecheck` clean (main + renderer) · `npm run build` clean (preload
bundle intact) · `hardenWebContents` unit-tested (H1–H3) · README Account-safety note added · no
guardrail weakened · **no other module refactored** (the review's explicit constraint).
