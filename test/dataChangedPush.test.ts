import { describe, it, expect, vi } from 'vitest';
import { createDataProvider, DASHBOARD_WRITES, type DataProviderDeps } from '../src/main/dataProvider';
import type { GameRecord } from '../src/core/analytics';
import type { AppConfig } from '../src/main/config';

/**
 * The `onDataChanged` announcement: every write that moves what the dashboard
 * would return must announce, so an open window refetches instead of sitting on
 * a pre-write rank. This is the durable half of the "top-left rank chip is
 * always delayed" fix — the renderer-side half (Review refetching on save) is
 * unit-untestable here, since the renderer has no test harness.
 *
 * The load-bearing case is a write the RENDERER DIDN'T MAKE: the MCP server
 * writes through this same provider, and reaches no view callback of its own.
 */

const anchors = new Map<string, unknown>();

function makeDeps(announceChange?: () => void): DataProviderDeps {
  const games: GameRecord[] = [];
  return {
    getConfig: () => ({ accounts: {}, ui: { demoPreference: 'off' } }) as unknown as AppConfig,
    history: {
      count: () => games.length,
      all: () => games,
      setReview: vi.fn(),
      editManual: vi.fn(),
      clearReview: vi.fn(),
      addMany: () => ({ imported: 0 }),
      mergeImported: () => ({ merged: 0, skipped: 0 }),
    },
    rankAnchors: {
      set: (a: { account: string; role: string }) => anchors.set(`${a.account}::${a.role}`, a),
      all: () => [],
      get: () => undefined,
      map: () => ({}),
    },
    placements: { allRuns: () => [], getRun: () => undefined },
    notify: vi.fn(),
    ...(announceChange ? { announceChange } : {}),
  } as unknown as DataProviderDeps;
}

describe('DataProvider — onDataChanged announcement', () => {
  it('announces after a review save (the path that left the rank chip stale)', () => {
    const announceChange = vi.fn();
    const provider = createDataProvider(makeDeps(announceChange));

    provider.saveReview({ matchId: 'm1', grades: {}, flags: {}, srDelta: 22 });

    expect(announceChange).toHaveBeenCalledTimes(1);
  });

  it('announces after a rank anchor is set', () => {
    const announceChange = vi.fn();
    const provider = createDataProvider(makeDeps(announceChange));

    provider.setRankAnchor({ account: 'You', role: 'Tank', tier: 'Gold', division: 3, progressPct: 40 });

    expect(announceChange).toHaveBeenCalledTimes(1);
  });

  it('does NOT announce for reads', () => {
    const announceChange = vi.fn();
    const provider = createDataProvider(makeDeps(announceChange));

    provider.games();
    provider.getRanks();
    provider.isSample();

    expect(announceChange).not.toHaveBeenCalled();
  });

  it('does NOT announce for writes that already push — one action, one refetch', () => {
    const announceChange = vi.fn();
    const deps = makeDeps(announceChange);
    (deps as unknown as { recordGame: () => boolean }).recordGame = () => true;
    (deps as unknown as { dismissPending: () => boolean }).dismissPending = () => true;
    const provider = createDataProvider(deps);

    // logMatch pushes onGameLogged; dismissPendingMatch pushes onPendingChanged.
    provider.logMatch({ result: 'Win', role: 'Tank', map: 'Ilios', gameType: 'Competitive' } as never);
    provider.dismissPendingMatch('m1');

    expect(announceChange).not.toHaveBeenCalled();
  });

  it('announces only AFTER an async write settles, never before', async () => {
    const announceChange = vi.fn();
    const deps = makeDeps(announceChange);
    let resolveImport: (v: unknown) => void = () => {};
    const pending = new Promise((r) => { resolveImport = r; });
    (deps as unknown as { notion: { import: () => Promise<unknown> } }).notion = {
      import: () => pending as Promise<unknown>,
    };
    const provider = createDataProvider(deps);

    const inFlight = provider.importNotion();
    // Still writing — announcing here would make a refetch read pre-write state.
    expect(announceChange).not.toHaveBeenCalled();

    resolveImport({ games: [], imported: 0, skipped: 0 });
    await inFlight;
    expect(announceChange).toHaveBeenCalledTimes(1);
  });

  it('leaves the provider untouched when no announcer is injected (headless/tests)', () => {
    const provider = createDataProvider(makeDeps());
    expect(() => provider.saveReview({ matchId: 'm1', grades: {}, flags: {} })).not.toThrow();
  });

  it('pins every DASHBOARD_WRITES name to a real provider method', () => {
    // A renamed or removed provider method must not silently drop out of the
    // announce list — that is exactly how the chip went stale in the first place.
    const provider = createDataProvider(makeDeps(vi.fn()));
    const missing = DASHBOARD_WRITES.filter(
      (name) => typeof (provider as unknown as Record<string, unknown>)[name] !== 'function',
    );
    expect(missing).toEqual([]);
  });

  it('lists no duplicates', () => {
    expect(new Set(DASHBOARD_WRITES).size).toBe(DASHBOARD_WRITES.length);
  });
});
