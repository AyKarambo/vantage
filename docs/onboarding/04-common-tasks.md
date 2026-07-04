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
2. **Provider:** implement it on the provider in
   [`src/main/dashboard/provider.ts`](../../src/main/dashboard/provider.ts), delegating
   real logic to `src/core/` or the stores.
3. **Handler:** register the one-line forward in
   [`src/main/dashboard/ipcHandlers.ts`](../../src/main/dashboard/ipcHandlers.ts).
4. **Preload and bridge need no changes** — both are generated from `IPC_CHANNELS`.
5. **Preview mock:** add a fake implementation in
   [`renderer/preview/preview.ts`](../../renderer/preview/preview.ts) so the browser
   harness keeps working (typecheck will remind you).
6. Call it from the renderer via `bridge.myMethod(...)`.

## Adding a chart

Charts are dependency-free SVG. Add a builder under
[`renderer/src/charts/plots/`](../../renderer/src/charts/plots) using the `svgEl` /
`svgRoot` / `svgText` factories in [`svg.ts`](../../renderer/src/charts/svg.ts), export
it from `plots/index.ts`, and take colors from
[`theme.ts`](../../renderer/src/theme.ts) (`PALETTE`, `wrColor`, `modeColor`) — SVG
can't read CSS custom properties, which is why the palette is mirrored in JS.
`donutChart.ts` is a good template (data-in, element-out, hover tooltip, legend).

## Adding a test

Conventions ([`test/`](../../test), vitest, node environment):

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

## Debugging the live pipeline without the game

1. Have someone (or a past you) run `OW_SYNC_RECORD=1 npm start` during real matches —
   this captures the GEP stream to `userData/recordings/*.jsonl`.
2. Replay it anytime: `OW_SYNC_REPLAY=<path-to.jsonl> npm start`. The recording flows
   through the *real* `pipeline.feed()` → aggregator → history path.
3. For a quick smoke test, `OW_SYNC_SIMULATE=1 npm start` feeds one synthetic match
   (`SIM-` prefixed matchId — safe to delete from `history.json` afterwards).

## Working on the Notion export

- Set a token via the app UI, or `NOTION_TOKEN=<token>` for dev (env beats the
  encrypted file). Use a throwaway Notion workspace.
- The schema (required properties, select options) is pure data in
  [`gametrackerSchema.ts`](../../src/notion/gametrackerSchema.ts) — change it there and
  both auto-create and validation follow.
- Dedupe lives in `outbox.json`; delete it to re-export everything.
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
