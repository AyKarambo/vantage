# Spec: Dashboard window navigation & new-window hardening

- **Slug:** `window-nav-hardening`
- **Status:** done

## Intent (WHAT & WHY)

Account safety (Guardrail 1) demands the desktop shell be a contained surface. The dashboard
`BrowserWindow` holds the big-ticket Electron protections — `contextIsolation: true`,
`nodeIntegration: false`, a sandboxed & bundled preload, a curated `contextBridge` surface
(`window.owstats`, never raw `ipcRenderer`), and a strict CSP
(`default-src 'none'; script-src 'self'`) — and, on top of those, closes the navigation /
new-window and IPC-sender gaps from the canonical Electron security checklist (items 12–14 and
17, per the official [security tutorial](https://www.electronjs.org/docs/latest/tutorial/security)).

**Why it matters:** if any content ever ran in the renderer (an injected string, a future
dependency, a mistaken `target=_blank` link), an unhardened window could navigate to an attacker
origin or spawn an uncontrolled child window — turning a contained renderer into a phishing or
data-exfil surface, and any web frame could address `ipcMain` directly. The hardening here is
pure defense-in-depth reinforcing the account-safe, local-first design; it is low-risk because
the renderer performs **no** in-window navigation and opens **no** windows — every external link
routes through `shell.openExternal` in the main process (`src/main/index.ts`).

The rest of the architecture — composition root, typed IPC contract, pure `core/`, framework-free
renderer, persistence — is deliberately untouched by this spec.

## Behavior (WHAT it is)

- **New-window / popups denied.** `setWindowOpenHandler` on the dashboard window returns
  `{ action: 'deny' }`; no child window is created.
- **In-window navigation and redirects denied.** `will-navigate` and `will-redirect` both
  `preventDefault()`, so the window stays on its loaded bundle. The app's own `loadFile()`/reload
  is a programmatic navigation that emits neither event, so it is unaffected.
- **Sandbox explicit.** The dashboard `BrowserWindow` sets `webPreferences.sandbox: true`
  explicitly, alongside `contextIsolation: true` and `nodeIntegration: false`. (The preload is
  bundled precisely because sandboxed preloads cannot `require` local modules; it uses only
  `electron`'s `contextBridge`/`ipcRenderer`, both available in sandboxed preloads.)
- **IPC sender validation.** Every `ipcMain.handle`/`ipcMain.on` wrapper runs a pure predicate
  against the sender frame and accepts only the app's own bundle page (`file:` URL whose path ends
  `/renderer/index.html`, case-insensitive — covering dev `file:///…` and packed `…/app.asar/…`
  loads). Untrusted `invoke`s reject; untrusted sends are dropped. Compile-time contract typing
  already covers argument *shape* for the trusted renderer, so this validates the sender only, not
  per-call payload schemas.
- **Pure-testable helpers.** The window-open/navigation policy lives in
  `hardenWebContents(contents)` and the sender check in a pure predicate, both in
  `src/main/dashboard/webContentsSecurity.ts` (a type-only `import type { WebContents }`, so no
  Electron code loads at runtime and both are trivially fakeable in tests).
- **Scope:** the policy is registered on the single dashboard window's `webContents`, not globally
  via `app.on('web-contents-created')` — the app owns exactly one window.

## Out-of-Scope (non-goals)

- **Any other refactor.** No changes to the composition root, IPC contract, core, renderer store,
  charts, or persistence.
- **Global `app.on('web-contents-created', …)` registration.** Window-scoped is sufficient for a
  single-window app; the global option is a future extension if more windows are ever added.
- **Per-call runtime payload schemas.** Sender-frame validation only; argument shape is covered by
  the compile-time contract for the trusted renderer.
- **CSP changes.** The existing CSP is strict and correct; not touched.
- **User-visible behavior.** Users see no functional change — the app never navigated or opened
  windows to begin with.

## Constraints

- **Guardrails (CLAUDE.md) hold:** GEP-only (1); no secrets in git (2); `src/core/` stays pure &
  Electron-free (3) — the helpers live under `src/main/`, the Electron edge, not in core; renderer
  stays CSP-friendly, one esbuild bundle (4); local-first, opt-in export (5).
- **No feature regression.** External-link opening (`shell.openExternal` for the tray Gametracker
  URL and support mailto) keeps working — it lives in the main process and is unaffected.
- **Pure logic is unit-tested.** The policy helper and sender predicate ship with vitest tests.
- **Preload/build intact.** Changes are main-process only; `npm run build` keeps the esbuild
  preload bundle valid.
- **Definition of Done:** `npm test` green, `npm run typecheck` clean (main + renderer),
  `npm run build` clean, helpers unit-tested, README Account-safety note present, no guardrail
  weakened.

## Acceptance Criteria

- **H1 — Popups denied.**
  Given the dashboard renderer,
  When any code attempts to open a new window (`window.open`, `target=_blank`, or a
  programmatic child window),
  Then the window-open handler returns `{ action: 'deny' }` and no child window is created.

- **H2 — Navigation blocked.**
  Given the dashboard window has loaded its bundle,
  When an in-page navigation is attempted (a link click, `window.location` change, or form post),
  Then the `will-navigate` handler calls `preventDefault()` and the window stays on the bundle.

- **H3 — Redirects blocked.**
  Given a navigation that would server-side redirect,
  When `will-redirect` fires,
  Then it is prevented.

- **H4 — The app's own load is unaffected.**
  Given the window's initial `loadFile()` (and any programmatic reload),
  When the app starts,
  Then the dashboard renders normally — the guards do not fire, because `loadFile`/`loadURL` are
  programmatic navigations that do not emit `will-navigate`/`will-redirect`.

- **H5 — Sandbox explicit.**
  Given the dashboard `BrowserWindow`,
  When it is created,
  Then `webPreferences.sandbox` is `true` explicitly, alongside `contextIsolation: true` and
  `nodeIntegration: false`.

- **H6 — External links still open.**
  Given the tray "Open Gametracker" / "Support" actions,
  When invoked,
  Then they open via `shell.openExternal` (main-process path).

- **H7 — Untrusted invoke rejected.**
  Given an `ipcMain.handle` channel,
  When a message arrives from a frame that is not the app's own renderer bundle
  (`file:…/renderer/index.html`),
  Then the handler does not run and the invoke rejects.

- **H8 — Untrusted send dropped.**
  Given an `ipcMain.on` channel (window controls),
  When the sender frame is untrusted,
  Then the action is silently ignored.

- **H9 — Trusted renderer unaffected.**
  Given the app's own renderer frame,
  When it invokes any channel,
  Then the handler runs exactly as expected — the guard is transparent to normal use.

- **H10 — Robust allowlist.**
  Given dev (`file:///…/renderer/index.html`) and packed (`…/app.asar/renderer/index.html`)
  loads, and a null / remote / wrong-page sender,
  When the sender URL is checked,
  Then only the app's own bundle page (`file:` + path ending `/renderer/index.html`,
  case-insensitive) is accepted.

- **X1** `npm test` passes; **X2** `npm run typecheck` clean (main + renderer); **X3** the helpers
  have vitest tests; **X4** `npm run build` clean (preload bundle intact); **X5** README Account
  safety note present; **X6** no guardrail weakened, and no other module refactored.

## Design decisions

- **Window-scoped, not global.** The policy is registered on the single dashboard window's
  `webContents` (`DashboardWindow.open()`), keeping the change cohesive within the class that owns
  the window; revisit if additional windows are ever introduced.
- **Deny-all navigation, not a same-origin allowlist.** The renderer never navigates in-window
  (routing is store-driven, not URL-driven; no hash/history usage), so deny-all is stricter and
  simpler than an allowlist for a case that cannot occur.
- **Extracted helpers, not inline handlers.** The policy and sender predicate live in
  `webContentsSecurity.ts` so they are unit-tested (matching the main-process test precedent) and
  the window class stays lean; a type-only `WebContents` import keeps them Electron-free at runtime.
- **`sandbox: true` is stated, not relied on implicitly.** It documents intent and guards against a
  future implicit-default change, with no runtime behavior change (the preload is already sandboxed
  and bundled).
- **Sender validation, not payload schemas.** Any web frame can address `ipcMain`, so main
  re-checks the sender frame rather than trusting that only the narrow preload can call; per-call
  argument schemas are deliberately not added, since compile-time contract typing already covers
  argument shape for the trusted renderer.
