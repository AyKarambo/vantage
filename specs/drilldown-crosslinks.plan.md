# Techplan: `drilldown-crosslinks`

Derived from [`drilldown-crosslinks.spec.md`](./drilldown-crosslinks.spec.md).

## Decisions

1. **Scope carrier = `ViewParams`, not `DashboardFilters`.** Day/flag are one-shot drill-downs
   into the Matches list, not global re-scopes; params already reset on navigation, giving AC 5's
   "leaves no residue" for free. Add `day?: string` (a `dayKey` value, `YYYY-MM-DD` UTC) and
   `flag?: MatchFlagKey` to `ViewParams` (`renderer/src/store.ts:29`).

2. **Param-change plumbing (AC 6).** Two equality checks currently only know `matchId`/
   `highlight` and would swallow re-navigation or re-render:
   - `store.setView` dedupe (`renderer/src/store.ts:91-92`) — compare via a single
     `sameParams()` helper over all `ViewParams` keys instead of hand-listed fields.
   - Shell render key (`renderer/src/app/shell.ts:101`, `:230-235`) — include `day`/`flag`.

3. **Flags on the row (AC 2, testable).** New `MatchFlagKey = 'tilt' | 'toxicMates' | 'leaver' |
   'positiveComms'` and `MatchRow.flags?: Partial<Record<MatchFlagKey, true>>` in
   `src/shared/contract/dashboard.ts`. Computed in a new exported pure helper `rowFlags(g)` in
   `src/core/mental.ts` (reusing `leaverFlags`/`mergeLeaver` so the OR-merge semantics stay in
   one module), called from `toMatchRow` (`src/core/dashboardData.ts:134`). Only set keys are
   present (`{ tilt: true }`), keeping the payload lean. Preview harness needs no change (it
   runs `computeDashboard`).

4. **Matches view scope + chip (AC 1/2/5).** In `renderer/src/views/matches.ts`: derive
   `scoped = rows` filtered by `ctx.params.day` (via `dayKey(m.timestamp)` from
   `src/core/analytics` — same bucketing as `calendar()`) or by `ctx.params.flag`
   (`m.flags?.[flag]`). Chip row under the view head: `Only <label> ✕` →
   `ctx.navigate('matches')`. Header count uses the scoped list. Empty scoped list gets a
   friendly empty state with the chip still visible (so ✕ is reachable).

5. **Entry points.**
   - `calendarHeatmap(days, onPick?)` (`renderer/src/components/primitives/stats.ts:59`): opt-in
     `onPick(date)` wired only for cells with `games > 0` (pointer cursor + role=button); Trends
     passes `(date) => ctx.navigate('matches', { day: date })`. The Overview call site (none) and
     other call sites are unaffected — verified single call site in `trends.ts:31`.
   - Mental (`renderer/src/views/mental.ts:34-40`): wrap non-zero counts in a clickable statBox →
     `ctx.navigate('matches', { flag })`; leavers box maps to `'leaver'` (merged).
   - Heroes drawer (`renderer/src/views/heroes.ts:88-94`): By-map rows get the same
     `inline-link` treatment as Matches rows → close drawer + `ctx.navigate('maps',
     { highlight: mapName })`.
   - Readiness (`renderer/src/views/readiness.ts` verdict card): for bands `loaded`/`in-the-hole`,
     a hint line from `ctx.data.breakReminder` (`enabled`, `afterLosses`) + an inline-link to
     Mental.

6. **Chip labels.** Day: reuse `prettyDay`-style formatting (extract it or duplicate the 3-line
   helper); flag: human labels matching the Mental card ("Tilt", "Toxic mates", "Leavers",
   "Positive comms").

## Risks / watch-outs
- `groupByDay` header keys are **local-ish** labels while `calendar()`/`dayKey` are UTC buckets —
  the day filter must use `dayKey`, never the group label (spec constraint).
- `MatchRow` is also built by `heroDetail`'s recent list? — verify other `toMatchRow`-like
  construction sites; only `dashboardData.toMatchRow` builds `MatchRow` (heroDetail.recent is a
  distinct inline type), so one production site + tests.
- Don't break `reviewInbox` rows (same `toMatchRow`) — flags there are harmless extra data.

## Test plan
- `test/mental.test.ts` (or new `test/rowFlags.test.ts`): `rowFlags` OR-merge (mental only,
  review only, both; leaver side-merge incl. legacy `leaver`; empty → undefined).
- `test/vantageCore.test.ts`-style: `computeDashboard().matches[i].flags` present for a flagged
  fixture game.
- Renderer behavior verified in the preview walkthrough (AC 1/3/4/5/6), per repo convention
  (no DOM test rig).
