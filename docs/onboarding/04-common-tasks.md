# 04 — Common tasks

Recipes for the changes you'll make most often. Each one lists the touch points in
order; the pattern is always the same — **pure logic first (with a test), contract
second, plumbing third, UI last.**

## Adding a stat to the dashboard

Say you want "average match duration" on the Overview screen.

1. **Core:** compute it in the right module under
   [`src/core/analytics/`](../../src/core/analytics) (or a new small module). Pure
   function over `GameRecord[]`.
2. **Test:** add a case in [`test/`](../../test) — this is required by the Definition
   of Done for new core logic.
3. **Contract:** add the field to `DashboardData` in
   [`src/shared/contract/dashboard.ts`](../../src/shared/contract/dashboard.ts).
4. **Assemble:** populate it in `computeDashboard()`
   ([`src/core/dashboardData.ts`](../../src/core/dashboardData.ts)). The typecheck now
   fails until you do — that's the contract working for you.
5. **UI:** render it in the view, e.g.
   [`renderer/src/views/overview.ts`](../../renderer/src/views/overview.ts), composing
   existing primitives (`kpiCard`, `statBox`, …).
6. Verify in `npm run preview` — no plumbing changes needed, since the preview runs the
   real `computeDashboard()`.

## Adding a new screen

1. Write (or update) a spec in [`specs/`](../../specs) — every screen has one.
2. Create `renderer/src/views/myScreen.ts` exporting a
   `(ctx: ViewContext) => HTMLElement` function. Start by copying a similar view;
   use `viewHead()` and compose `components/`.
3. Register it in the `VIEWS` record and the sidebar nav in
   [`renderer/src/app/shell.ts`](../../renderer/src/app/shell.ts) (a `ViewId` union
   entry makes the compiler point at every spot that needs updating).
4. Navigation is just `ctx.navigate('myScreen')` — parameterized views (see
   `matchDetail`) read `ctx.params` at render time.
5. If the screen needs data not in `DashboardData`, follow
   [Adding a stat](#adding-a-stat-to-the-dashboard) or
   [Adding an IPC method](#adding-an-ipc-method) first.

## Adding an IPC method

For data that shouldn't ride along in the dashboard payload (like `heroDetail`):

1. **Contract:** declare the method on `OwStatsApi` *and* add the channel to
   `IPC_CHANNELS` in [`src/shared/contract/api.ts`](../../src/shared/contract/api.ts).
   Input/output types live in the contract too — never `any` across the boundary.
2. **Provider:** implement it in `createDataProvider`
   ([`src/main/dataProvider.ts`](../../src/main/dataProvider.ts)), delegating real logic
   to `src/core/` or the stores. `DataProvider` takes the method's signature from the
   contract, so the typecheck fails until it exists (add it to `AsyncProviderMethod` in
   [`handlers.ts`](../../src/main/dashboard/handlers.ts) if it does real async work). A
   method that is a composition over the provider rather than one of its own goes in
   that file's `composed` table instead.
3. **IPC, preload, bridge and preview need no changes** — the IPC handlers, the preload
   and the renderer bridge are generated from `IPC_CHANNELS`, and the browser preview
   runs the real provider.
4. Call it from the renderer via `bridge.myMethod(...)`.

## Adding a chart

Charts are dependency-free SVG. Add a builder under
[`renderer/src/charts/plots/`](../../renderer/src/charts/plots) using the `svgEl` /
`svgRoot` / `svgText` factories in [`svg.ts`](../../renderer/src/charts/svg.ts), export
it from `plots/index.ts`, and take colors from
[`theme.ts`](../../renderer/src/theme.ts) (`PALETTE`, `wrColor`, `modeColor`) — SVG
can't read CSS custom properties, which is why the palette is mirrored in JS.
`donutChart.ts` is a good template (data-in, element-out, hover tooltip, legend).

## Adding a test

Conventions ([`test/`](../../test), vitest, node environment — except `test/dom/`, below):

- **Constructor injection over module mocks.** Units take their dependencies as
  parameters, so tests pass `vi.fn()` fakes — you'll rarely need `vi.mock()`. See
  [`test/notionExporter.test.ts`](../../test/notionExporter.test.ts).
- **Real files for store tests:** `fs.mkdtempSync()` a temp dir, clean up in
  `afterEach`. See [`test/outbox.test.ts`](../../test/outbox.test.ts).
- **Pure core tests are just data in, data out.** See
  [`test/matchAggregator.test.ts`](../../test/matchAggregator.test.ts) for
  feeding synthetic `GepMessage` streams.
- No Electron imports in tests, ever — if you feel you need one, the logic is in the
  wrong layer.

Run `npm run test:watch` while developing.

## Renderer DOM tests (`test/dom/`)

`test/dom/**` runs in its own vitest project on **happy-dom** (everything else stays on
node), in UTC with an en-US default locale (see [`test/dom/setup.ts`](../../test/dom/setup.ts)).
[`test/dom/appHarness.ts`](../../test/dom/appHarness.ts) mounts the **real shell** over
the **real data layer** — `providerHarness` (real stores in memory) behind
`dashboardHandlers`, wired like the browser preview — with `Date` pinned, and records
every bridge call (`app.callsTo('logMatch')`).

They are *characterization* tests: they pin what the Log Match dialog, the match
editor and the expanded Review card send today (`logMatch` / `editMatch` /
`saveReview`, plus the rank-anchor and placement calls around them) and how the shell
navigates (sidebar, Back / Escape, the params-only re-render). A refactor of those
files must keep them passing unchanged; when you *mean* to change a payload, update
the pinned value (`npx vitest run test/dom -u` refreshes the inline snapshots) and
say why in the PR. Mount one app per file — the shell binds window-level keys.

## Visual regression (renderer changes)

The renderer has its own safety net: `npm run test:visual` bundles the browser preview,
opens it in ow-electron at the app's 1300×840 spec size and captures every sidebar
screen, the intro tour, the Log Match dialog, a match's detail page and its editor, and
an expanded Review card. Each PNG is compared pixel by pixel (pixelmatch) against the
committed baselines in [`test/visual/baselines/`](../../test/visual/baselines).

It is deterministic by construction: the clock is pinned with the preview's
`?now=<epoch ms>` switch, the seeded sample season is on (`?demo=on`), storage starts
empty, and the window runs in UTC / en-US at scale factor 1 with animations and the
caret disabled. The driver is
[`scripts/capture-screenshots.cjs`](../../scripts/capture-screenshots.cjs) (`--visual`
mode; its default mode makes the store screenshots).

- **A failure** writes the actual capture and a `*.diff.png` (changed pixels in red)
  to `test/visual/output/` (git-ignored) and exits non-zero. Open the diff first.
- **An intended change** (you meant to move pixels): `npm run test:visual -- --update`
  rewrites the baselines and drops any no longer captured. Commit them with the change
  and look at the PNG diff in the PR — that *is* the review of the visual change.
- **A refactor** (you meant to move no pixels) must pass without `--update`.
- Font rasterisation differs between machines/GPU drivers; baselines are made on the
  maintainer's Windows machine with hardware acceleration off. `VISUAL_MAX_DIFF=<n>`
  tolerates up to *n* differing pixels per screen if you must run elsewhere.

## Debugging the live pipeline without the game

1. Have someone (or a past you) run `OW_SYNC_RECORD=1 npm start` during real matches —
   this captures the GEP stream to `userData/recordings/*.jsonl`.
2. Replay it anytime: `OW_SYNC_REPLAY=<path-to.jsonl> npm start`. The recording flows
   through the *real* `pipeline.feed()` → aggregator → history path.
3. For a quick smoke test, `OW_SYNC_SIMULATE=1 npm start` feeds one synthetic match
   (`SIM-` prefixed matchId — safe to remove afterwards from the Matches screen, or by
   deleting its row from `history.db` directly).

## Working on the Notion export

- Set a token via the app UI, or `NOTION_TOKEN=<token>` for dev (env beats the
  encrypted file). Use a throwaway Notion workspace.
- The schema (required properties, select options) is pure data in
  [`gametrackerSchema.ts`](../../src/notion/gametrackerSchema.ts) — change it there and
  both auto-create and validation follow.
- Dedupe lives in `outbox.json`; delete it (from the data folder — see
  [01 — Getting started](01-getting-started.md#where-the-app-keeps-its-data)) to
  re-export everything.
- Remember guardrail 5: export is opt-in and user-initiated. Nothing may push data out
  automatically.

## Before you open a PR

From the Definition of Done in [`CLAUDE.md`](../../CLAUDE.md):

```bash
npm test && npm run typecheck
```

…plus unit tests for any new/changed `src/core/` logic, doc updates when user-visible
behavior or commands change, and no weakened guardrails. Match the local style:
2-space indent, single quotes, semicolons, camelCase module names.
