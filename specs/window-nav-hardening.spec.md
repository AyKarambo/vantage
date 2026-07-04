# Spec: Dashboard window navigation & new-window hardening

- **Slug:** `window-nav-hardening`
- **Status:** Draft (autonomous run — user reviews at the end)
- **Date:** 2026-07-05

## Intent (WHAT & WHY)

Vantage's core promise is account safety (Guardrail 1). The desktop shell already gets the
big-ticket Electron protections right: `contextIsolation: true`, `nodeIntegration: false`, a
sandboxed & bundled preload, a curated `contextBridge` surface (`window.owstats`, never raw
`ipcRenderer`), and a strict CSP (`default-src 'none'; script-src 'self'`). An architecture +
web-research review (2025–2026 Electron security consensus, incl. the official
[Electron security tutorial](https://www.electronjs.org/docs/latest/tutorial/security)) found the
architecture otherwise **already ideal** — with exactly one residual gap against the canonical
security checklist:

The dashboard `BrowserWindow` does **not** limit navigation or new-window creation. There is no
`setWindowOpenHandler`, no `will-navigate`/`will-redirect` guard, and `sandbox` is left implicit
(relying on the Electron ≥20 default rather than being stated). Checklist items 12–14 ("do not
enable / limit navigation" and "disable or limit creation of new windows") are unaddressed.

**Why it matters:** if any content ever managed to run in the renderer (an injected string, a
future dependency, a mistaken `target=_blank` link), it could navigate the window to an attacker
origin or spawn an uncontrolled child window — turning a contained renderer into a phishing or
data-exfil surface. Closing this is pure defense-in-depth that reinforces the zero-ban-risk,
local-first guarantee. It is **low-risk** because the renderer today performs **no** in-window
navigation and opens **no** windows: every external link already routes through
`shell.openExternal` in the main process (`src/main/index.ts`).

**Explicit non-goal of this work:** refactoring anything else. The review's verdict is that the
composition root, typed IPC contract, pure `core/`, framework-free renderer, and persistence are
already the ideal solution and must be left untouched. This spec is deliberately one small change.

## In-Scope

- Deny **new-window / popup** creation from the dashboard renderer (`setWindowOpenHandler` →
  `{ action: 'deny' }`).
- Deny **in-window navigation and redirects** away from the loaded bundle
  (`will-navigate` + `will-redirect` → `preventDefault()`).
- Make the renderer **sandbox explicit** (`webPreferences.sandbox: true`) — documents intent and
  is defense-in-depth; it matches the already-sandboxed reality (the preload is bundled precisely
  because sandboxed preloads cannot `require` local modules — commit `0b59709`).
- A small, **pure-testable** helper (`hardenWebContents`) so the security policy has a unit test,
  consistent with how other main-process modules (`logger`, `matchPipeline`) are tested here.
- A one-line note in the README **Account safety** section.

## Out-of-Scope (non-goals)

- **Any other refactor.** No changes to the composition root, IPC contract, core, renderer store,
  charts, or persistence. The review found these already ideal.
- **Global `app.on('web-contents-created', …)` registration.** Vantage has exactly one
  `BrowserWindow`; scoping the policy to the window it owns is sufficient and more cohesive. (The
  global belt-and-suspenders option is noted in the tech plan as a future extension if more
  windows are ever added.)
- **Runtime IPC payload validation / sender checks.** A separate, larger topic; the renderer is a
  trusted first-party bundle behind a strict CSP. Out of scope here.
- **CSP changes.** The existing CSP is already strict and correct; not touched.
- **New user-visible behavior.** Users see no functional change — the app never navigated or
  opened windows to begin with.

## Constraints

- **Guardrails (CLAUDE.md) hold:** GEP-only (1); no secrets in git (2); `src/core/` stays pure &
  Electron-free (3) — the helper lives under `src/main/`, the Electron edge, not in core; renderer
  stays CSP-friendly, one esbuild bundle (4); local-first, opt-in export (5).
- **No feature regression.** External-link opening (`shell.openExternal` for the gametracker URL
  and support mailto) must keep working — it lives in the main process and is unaffected.
- **Pure logic is unit-tested.** The policy helper ships with a vitest test (Definition of Done).
- **Preload/build intact.** Changes are main-process only; a full `npm run build` must keep the
  esbuild preload bundle valid (per `0b59709`).
- **Definition of Done:** `npm test` green, `npm run typecheck` clean (main + renderer),
  `npm run build` clean, helper unit-tested, README note added, no guardrail weakened.

## Acceptance Criteria

- **H1 — Popups denied.**
  Given the dashboard renderer,
  When any code attempts to open a new window (`window.open`, `target=_blank`, or a
  programmatic child window),
  Then the window-open handler returns `{ action: 'deny' }` and no child window is created.
  *(Pure-core-style helper, unit-tested.)*

- **H2 — Navigation blocked.**
  Given the dashboard window has loaded its bundle,
  When an in-page navigation is attempted (a link click, `window.location` change, or form post),
  Then the `will-navigate` handler calls `preventDefault()` and the window stays on the bundle.
  *(Unit-tested.)*

- **H3 — Redirects blocked.**
  Given a navigation that would server-side redirect,
  When `will-redirect` fires,
  Then it is prevented. *(Unit-tested.)*

- **H4 — The app's own load is unaffected.**
  Given the window's initial `loadFile()` (and any programmatic reload),
  When the app starts,
  Then the dashboard renders normally — the guards do not fire, because `loadFile`/`loadURL` are
  programmatic navigations that do not emit `will-navigate`/`will-redirect`.

- **H5 — Sandbox explicit.**
  Given the dashboard `BrowserWindow`,
  When it is created,
  Then `webPreferences.sandbox` is `true` explicitly, alongside the existing
  `contextIsolation: true` and `nodeIntegration: false`.

- **H6 — External links still open.**
  Given the tray "Open Gametracker" / "Support" actions,
  When invoked,
  Then they still open via `shell.openExternal` (unchanged, main-process path).

- **X1** `npm test` passes; **X2** `npm run typecheck` clean (main + renderer); **X3** the helper
  has a vitest test; **X4** `npm run build` clean (preload bundle intact); **X5** README Account
  safety note added; **X6** none of the five guardrails weakened, and no other module refactored.

## Resolved questions

Decisions taken autonomously (user authorized an autonomous run through PR creation):

1. **Scope: window-scoped vs. global hardening.**
   **Decision:** register the policy on the single dashboard window's `webContents`
   (`DashboardWindow.open()`), not globally via `app.on('web-contents-created')`. The app owns
   exactly one window; window-scoped keeps the change cohesive within the class that owns the
   window. Revisit if additional windows are ever introduced.

2. **Deny-all navigation vs. same-origin allowlist.**
   **Decision:** deny **all** `will-navigate`/`will-redirect`. The renderer never navigates
   in-window (routing is store-driven, not URL-driven; no hash/history usage), so a same-origin
   allowlist would add code for a case that cannot occur. Deny-all is stricter and simpler.

3. **Extract a helper vs. inline the handlers.**
   **Decision:** extract `hardenWebContents(contents)` into `src/main/dashboard/webContentsSecurity.ts`
   so the security policy is unit-tested (matching the repo's main-process test precedent) and the
   window class stays lean. The helper uses a **type-only** `import type { WebContents }` so it
   pulls no Electron code at runtime and is trivially fakeable in tests.

4. **`sandbox: true` — behavior change?**
   **Decision:** none at runtime. The preload is already bundled because it is already sandboxed
   (Electron ≥20 default; commit `0b59709`). Stating `sandbox: true` documents intent and guards
   against a future implicit-default change. Verified safe: the preload only uses `electron`
   (`contextBridge`, `ipcRenderer`), both available in sandboxed preloads.

## Open Questions

Proceeding on the stated default; flag on review if it should change.

- **O1 — README depth.** Default: a single sentence in *Account safety* noting the shell is
  hardened (context isolation, sandbox, CSP, no in-window navigation/popups). Not blocking.

## Addendum (post-research): IPC sender validation

Added after the deep-research pass completed. Its top confirmed finding (3-0 vote, Electron
security checklist item #17) was that main-process IPC handlers should **validate the sender**
of incoming messages — the one baseline the code omitted. Any web frame (subframe, child window)
can address `ipcMain`, so main must re-check rather than assume only our narrow preload can call.
Same boundary-hardening theme as this spec, so it ships in the same change.

**Scope discipline (from the research):** the stronger claim that *every handler must also
validate its arguments against a runtime schema* was **refuted 0-3** as over-strong. So this adds
**sender-frame validation only** — not per-call payload schemas (that would be the
over-engineering the review warns against). Compile-time contract typing already covers argument
shape for the trusted renderer.

- **H7 — Untrusted invoke rejected.**
  Given an `ipcMain.handle` channel,
  When a message arrives from a frame that is not the app's own renderer bundle
  (`file:…/renderer/index.html`),
  Then the handler is not run and the invoke rejects. *(Pure predicate, unit-tested.)*

- **H8 — Untrusted send dropped.**
  Given an `ipcMain.on` channel (window controls),
  When the sender frame is untrusted,
  Then the action is silently ignored. *(Unit-tested via the predicate.)*

- **H9 — Trusted renderer unaffected.**
  Given the app's own renderer frame,
  When it invokes any channel,
  Then the handler runs exactly as before — the guard is transparent to normal use.

- **H10 — Robust allowlist.**
  Given dev (`file:///…/renderer/index.html`) and packed (`…/app.asar/renderer/index.html`)
  loads, and a null / remote / wrong-page sender,
  When the sender URL is checked,
  Then only the app's own bundle page (`file:` + path ending `/renderer/index.html`,
  case-insensitive) is accepted. *(Unit-tested.)*
