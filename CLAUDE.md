# Vantage — Project Constitution

Vantage is an **account-safe Overwatch stats coach**: it turns match history into
priority maps, per-hero stats, mental tracking, and improvement targets, with optional
Notion export. Built on **ow-electron** (Overwolf's Electron) — a frameless desktop app.

## Stack & Tooling
- **Language:** TypeScript, `strict` mode. Main targets ES2021 / CommonJS.
- **Shell/runtime:** ow-electron (`@overwolf/ow-electron`). Live game data via the
  Overwolf **GEP** package.
- **Main process (`src/`):** pure domain logic in `core/`; Electron/Overwolf/Notion
  plumbing at the edges (`main/`, `store/`, `notion/`).
- **Renderer (`renderer/`):** framework-free, composition-first TypeScript bundled to one
  CSP-friendly script by **esbuild**. `h()` (`renderer/src/dom.ts`) is the composition primitive.
- **Tests:** vitest. **Export:** `@notionhq/client` (optional). **Package manager:** npm.

## Overwolf development & docs lookup (ow-electron)
This is an **ow-electron** (Overwolf Electron) project — follow these rules before writing or
debugging any Overwolf / Electron / GEP code (adapted from Overwolf's
[AI coding-assistant config guide](https://dev.overwolf.com/ow-electron/guides/dev-tools/ai-coding-assistants-config)).
- **Packages — never swap for the vanilla equivalents.** The runtime is `@overwolf/ow-electron`
  and the builder is `@overwolf/ow-electron-builder`; `npm start`/`dev` launch through
  `ow-electron`, `npm run release` through `ow-electron-builder` — never vanilla `electron` /
  `electron-builder`. Keep the `"overwolf": { "packages": ["gep"] }` block in `package.json`
  (the gaming packages this app loads). All Overwolf packages live under the `@overwolf` scope.
- **API lookup order — verify, don't guess API shapes.**
  1. Search the local type definitions first — glob `node_modules/@overwolf/**/*.d.ts` (e.g.
     `@overwolf/ow-electron-packages-types` for GEP). Cite the `file:line` for any type used.
  2. Only if the symbol isn't there, or you need a conceptual/how-to answer, query the docs MCP.
- **Overwolf docs MCP.** Tool `mcp__ow-docs-mcp__algolia_search_index_overwolf`; always filter
  with `facet_docusaurus_tag: ["docs-ow-electron-current"]` (this is ow-electron, **not**
  ow-native). If the MCP server isn't connected, say so and ask the user to reload — don't guess.
- **Dev Mode auth (real GEP before store approval).** Gaming packages only load once ow-electron
  authenticates, and its dev-mode check reads credentials **only** from the environment —
  `OW_CLI_EMAIL` + `OW_CLI_API_KEY` (or an `OW_DEV_KEY` bearer token). It does **not** read the
  `ow config` credentials file (`~/.ow-cli/credentials`) at runtime; `npm start` / `npm run dev`
  bridge that file into those env vars via `scripts/ow-dev.mjs`. Credentials never enter git
  (guardrail 2).

## Build & Test
- `npm test` — run the vitest suite once (`test:watch` for watch mode).
- `npm run typecheck` — tsc for main (`tsconfig.json`) + renderer (`renderer/tsconfig.json`), no emit.
- `npm run build` — tsc (main) + esbuild (renderer bundle). `npm run watch:renderer` rebuilds on change.
- `npm start` — build and run with the demo dataset.
- `npm run preview` — bundle the browser harness, serve at http://localhost:5178 (no Overwolf runtime needed).
- `npm run release` — ow-electron-builder → `release/Vantage-Setup-<ver>.exe`.
- Dev-only env flags: `OW_SYNC_SIMULATE=1`, `OW_SYNC_SENSOR=gep|counterwatch`,
  `OW_SYNC_RECORD=1`, `OW_SYNC_REPLAY=<file>`.

## Conventions
- **Formatting:** 2-space indent, single quotes, semicolons. Match surrounding files.
- **Naming:** camelCase `.ts` modules (`dashboardData.ts`, `matchAggregator.ts`).
- **Folders:**
  - `src/core/` — pure, Electron-free domain logic (analytics, dashboardData, mental,
    progression, targets, maps, resolvers). Fully unit-tested.
  - `src/shared/contract/` — the single typed IPC contract shared by main **and** renderer,
    barreled through an `index.ts` so consumers still import from `'shared/contract'`.
  - `src/main/` — window, tray, GEP, preload, config. `src/store/` — local persistence.
    `src/notion/` — optional export edge.
  - `renderer/src/` — `components/`, `charts/` (dependency-free SVG), `views/` (one per screen),
    `app/` (shell + modals), `store.ts` (reactive store).
  - `test/` — `*.test.ts` (vitest).
- Views **compose** `components/`; don't hand-roll markup. Charts stay dependency-free SVG.
- Keep the IPC contract typed end-to-end; don't smuggle `any` across the boundary.

## Guardrails (never violate)
1. **Account safety — GEP only.** Live match data comes solely from Overwolf's Game Events
   Provider. Never read game memory, inject, or expose hidden info. This is the product's
   core promise and its GEP-only account-safety design.
2. **No secrets in git.** Code-signing material, Notion tokens, and keys are never committed.
   The signing key lives in Certum's cloud HSM, accessed interactively via SimplySign Desktop
   (mobile OTP) at release time — there are **no signing secrets in GitHub Actions or git**. The
   TOTP enrollment seed lives in a password manager; Notion tokens live in user config, not source.
3. **`core/` stays pure & Electron-free.** Nothing under `src/core/` imports
   Electron/Overwolf/Notion — this keeps domain logic unit-testable and able to drive the
   browser preview. Plumbing stays at the edges.
4. **Renderer stays CSP-friendly.** No inline scripts, no `eval`, no CDN / runtime-fetched
   remote code. The renderer ships as one esbuild bundle — required for Overwolf store review.
5. **Local-first, opt-in export.** All match history and manual data stays on-device by
   default. The only outbound path is Notion export, which requires the user's own token
   and an explicit action.

## Definition of Done
A change is done only when:
1. `npm test` passes.
2. `npm run typecheck` is clean (main + renderer).
3. New or changed pure logic under `src/core/` ships with unit tests in `test/`.
4. README / relevant docs are updated when user-visible behavior or commands change.
…and none of the Guardrails above are weakened.
