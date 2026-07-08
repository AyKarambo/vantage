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
   core promise and the zero-ban-risk guarantee.
2. **No secrets in git.** Code-signing material (SSL.com eSigner credentials), Notion tokens,
   and keys are never committed. Signing credentials live in GitHub Actions secrets or local
   env vars; tokens live in user config, not source.
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
