---
slug: about-page
status: done
updated: 2026-07-13
---

# Spec: About screen (`about-page`)

**Slug:** `about-page`
**Related:** `screen-settings.spec.md` (Diagnostics links here), `live-status.spec.md`
(account-safety wording), `window-nav-hardening.spec.md` (external-link opening).

## Intent (WHAT & WHY)

The About screen answers, in one glance, *"what is this app, which version am I on, is it
safe, how do I get help, and what do I paste into a bug report?"* It is the single
permanent, user-facing home for three things:

1. **Support & diagnosability.** The app version *and* the runtime build
   (ow-electron/Electron/Chromium/Node/V8/OS) sit behind a one-click **Copy diagnostics**
   shortcut, turning a support round-trip into a paste.
2. **Trust — the product's promise, restated in-app.** Vantage is **account-safe** (reads
   only Overwolf's sanctioned GEP feed — never game memory, no injection, no hidden
   information) and **local-first** (data stays on the device; the only outbound path is the
   user's own Notion export). The About screen states these plainly, and notes the app is
   **free to use**.
3. **Polish.** A store-quality desktop app has an About screen.

## Behavior (WHAT it is)

- **A top-level "About" screen**, a routable view reachable from the sidebar **App** group
  (next to Settings) and the **command palette** (Ctrl+K nav list). It restores as the
  last-visited screen on relaunch, is dedupe-safe, and is account-agnostic (suppresses the
  global filter bar, like `readiness`).
- **Identity block:** the Vantage brand mark, the "Vantage" wordmark, the product tagline
  ("Account-safe Overwatch stats coach"), and the **version number shown prominently** (e.g.
  `Version 0.1.0`).
- **Account-safety & privacy promises**, stated plainly: GEP-only sanctioned data source;
  local-first with opt-in Notion export; free to use.
- **Build & runtime block** (for support), as labelled rows: app version, ow-electron/Electron
  version, Chromium, Node, V8, platform + OS release, and a dev-vs-packaged indicator.
- **"Copy diagnostics" action:** copies a plain-text block (product + version + build/runtime +
  platform) to the clipboard for pasting into a bug report, with a toast confirmation. The exact
  text is produced by a **pure formatter in `src/core/`** so it is unit-testable.
- **Support & legal:** support email as an outbound `mailto:` link, license (**MIT**), and a
  copyright line (© Timo Seikel). Outbound links open through the app's **sanctioned
  `shell.openExternal` path** (see Constraints), never as in-app navigations.
- **Convenience links** to existing surfaces, as in-app navigations (not duplicated controls): the
  data-storage folder (→ Settings) and the debug log (→ Logs).
- **Contract:** the typed `AppInfo` carries the build/runtime fields, populated only at the
  main-process edge (`app.getVersion()`, `process.versions`, `process.platform`, `os.release()`,
  `app.isPackaged`). A minimal, scheme-allowlisted `openExternal(url)` bridge method routes to
  `shell.openExternal`.
- **Settings:** Settings → Diagnostics carries a compact **"About Vantage →"** link to this
  screen rather than an inline version line, so identity/version has a single source of truth.
- **Preview harness:** `renderer/preview/preview.ts` stubs the `AppInfo` fields and
  `openExternal` so the screen renders fully in the browser harness with no Overwolf runtime.

## Out-of-Scope

- **No "check for updates" / in-app updater.** Releases are handled by the release pipeline
  (`npm run publish:release`); the About screen neither checks nor installs versions.
- **No changelog / release-notes rendering.** (May link out later; not rendered here.)
- **No network calls from About** — no telemetry, no version-check ping. The screen is fully offline.
- **No i18n / localization** (the app is English-only).
- **The support email, license, and links are not user-configurable.**
- **No arbitrary external web links beyond what a maintainer explicitly hard-codes** (e.g. support
  mailto); no dynamic/user-supplied URLs are ever passed to the opener.

## Constraints

- **Guardrail 1 (GEP-only) & 3 (`core/` stays pure).** All version/runtime facts are gathered at the
  **main edge only**; `src/core/` receives already-collected `AppInfo` and merely *formats* it. No
  Electron/Overwolf import enters `core/`.
- **Guardrail 4 (CSP-friendly renderer).** `hardenWebContents` denies popups and `preventDefault`s
  every in-window navigation, so a bare `<a href>` click is swallowed. All outbound links therefore
  go through the main-process `shell.openExternal` via the `openExternal(url)` IPC method, which
  **validates the scheme against an allowlist (`mailto:`, `https:`)** before opening. No inline
  scripts, no `eval`, no remote/CDN code. Clipboard uses the standard async
  `navigator.clipboard.writeText` (no new remote surface).
- **Guardrail 5 (local-first).** About performs no outbound data flow; the only network-capable
  action is the user explicitly clicking a hard-coded support/`mailto:` link.
- **Typed contract end-to-end.** The `AppInfo` fields and `openExternal` method flow through
  `api.ts` (interface + `IPC_CHANNELS`), preload, the provider, and the renderer bridge with **no
  `any`** across the boundary; the `satisfies` invariants in `api.ts` compile.
- **Composition-first renderer.** The view composes existing `components/` primitives (`card`,
  `button`, `pill`/`chip`, etc.) via `h()`; it does not hand-roll bespoke markup or restyle globally.
- **Preview-driveable.** The screen renders fully in `npm run preview` using stubbed `AppInfo`
  (`version: 'preview'` plus placeholder build fields) and a no-op/stub `openExternal`.
- **Definition of Done** (from CLAUDE.md): `npm test` green; `npm run typecheck` clean (main +
  renderer); the pure `core/` formatter has vitest tests; README / screens list mentions the
  About screen.

## Acceptance Criteria

1. **Reachable from the sidebar.**
   Given the app is open, When I look at the sidebar **App** group, Then I see an **About** item next
   to **Settings**, and clicking it opens the About screen with **About** highlighted as active.

2. **Reachable from the palette + restored on relaunch.**
   Given I open the command palette (Ctrl+K), When I pick **About**, Then the About screen opens; And
   Given About is the last screen I viewed, When I relaunch the app, Then it re-opens on About.

3. **Version shown prominently.**
   Given I am on the About screen, When it renders, Then the app version (e.g. `0.1.0`) is displayed
   prominently in the identity block — not buried — matching `getAppInfo().version`.

4. **Build & runtime rows.**
   Given I am on the About screen, When it renders, Then I see labelled rows for at least: app
   version, ow-electron/Electron, Chromium, Node, V8, platform + OS release, and whether the build is
   packaged or a dev build — each populated from the `AppInfo` fields (real values in the app,
   stub values in preview).

5. **Copy diagnostics.**
   Given I am on the About screen, When I click **Copy diagnostics**, Then a plain-text block
   containing the product name, version, and every build/runtime/platform field is written to the
   clipboard, And a toast confirms the copy. The exact string is produced by the pure `core/`
   formatter (unit-tested), so the same input always yields the same output.

6. **Account-safety & privacy promises are present.**
   Given I am on the About screen, When it renders, Then it states, in plain language, both that
   Vantage reads only Overwolf's sanctioned GEP feed (account-safe — no game memory reads, no
   injection, no hidden information) and that data is local-first with Notion export as the only
   opt-in outbound path. It also notes, in plain language, that the app is free to use.

7. **Support link opens safely.**
   Given I click the support-email link, When the click is handled, Then it opens the OS mail client
   via the sanctioned `shell.openExternal` main-process path (not an in-window navigation), And the
   renderer never navigates away from its bundle.

8. **`openExternal` rejects unsafe schemes.**
   Given the renderer requests `openExternal` with a URL whose scheme is not on the allowlist
   (`mailto:`/`https:`) — e.g. `file:`, `javascript:` — When main handles it, Then it refuses to open
   the URL (no `shell.openExternal` call for that URL).

9. **Settings single-sources identity.**
   Given I open Settings → Diagnostics, When it renders, Then it shows an **"About Vantage →"** link
   that navigates to the About screen (no inline `Vantage <version> · support: …` line); the version
   is authoritative on the About screen.

10. **Convenience links navigate in-app.**
    Given I am on the About screen, When I click the data-storage or debug-log convenience link, Then
    the app navigates to Settings (Data storage) or the Logs viewer respectively, without leaving the
    bundle.

11. **Renders in the preview harness.**
    Given `npm run preview` is running, When I navigate to About, Then the screen renders with the
    stubbed `AppInfo` (version `preview`, placeholder build fields) and no console errors, and Copy
    diagnostics + links are wired to the harness stubs.

12. **Definition of Done holds.**
    Given the change is complete, When I run `npm test` and `npm run typecheck`, Then both pass; And
    the `core/` formatter has vitest coverage; And the screens doc/README lists the About screen.

## Design decisions

- **A dedicated top-level About screen** in the App nav group (not an expanded Settings card); the
  Settings version line is a link into it, so identity/version has one source of truth. (AC 1, 9.)
- **What it shows:** identity + prominent version; account-safety & local-first promises + the
  free-to-use note; a build/runtime block for support; Copy-diagnostics; support mailto; license
  (MIT) + copyright; convenience links to Data storage and Logs. Deliberately excluded: updater,
  changelog, telemetry (see Out-of-Scope).
- **Richer version data via the `AppInfo` contract**, gathered at the main edge
  (`process.versions`, `process.platform`, `os.release()`, `app.isPackaged`); `core/` stays pure and
  only formats. Reading these in the renderer would need Electron there (guardrail violation).
- **Outbound links under the nav-hardening lock** go through the scheme-validated
  (`mailto:`/`https:`) `openExternal(url)` bridge to the sanctioned `shell.openExternal`; a bare
  `<a href>` is swallowed by `hardenWebContents`, and only hard-coded maintainer links are used.
  (AC 7, 8.)
- **Copy-diagnostics** is a pure `src/core/about.ts` formatter, unit-tested, reused by both the
  on-screen rows and the clipboard string. (AC 5.)

## Open Questions

- **Repository / homepage link.** No canonical public URL is committed today; `openExternal` already
  supports `https:` if/when one is chosen. Support `mailto:` ships now; a repo link is a one-line
  follow-up.
- **License text depth.** The short line ("MIT © Timo Seikel") is shown; a full third-party
  acknowledgements list (Overwolf GEP, Electron, Notion SDK) can be added later without contract
  changes.
