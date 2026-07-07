import { describe, it, expect, vi } from 'vitest';
import { createDataProvider, type DataProviderDeps } from '../src/main/dataProvider';
import { rankKey } from '../src/core/rank';
import type { GameRecord } from '../src/core/analytics';
import type { Role } from '../src/core/model';
import type { ManualMatchInput } from '../src/shared/contract';

function harness() {
  const recorded: GameRecord[] = [];
  const deps = {
    recordGame: (g: GameRecord) => { recorded.push(g); },
    getConfig: () => ({ accounts: { main: 'Main' } }),
    notify: vi.fn(),
  } as unknown as DataProviderDeps;
  return { provider: createDataProvider(deps), recorded };
}

const input = (extra: Partial<ManualMatchInput> = {}): ManualMatchInput => ({
  result: 'Win', role: 'damage', map: 'Ilios', gameType: 'Quick Play', ...extra,
});

describe('logMatch — playedAt backfill', () => {
  it('stamps "now" when playedAt is omitted', () => {
    const { provider, recorded } = harness();
    const before = Date.now();
    provider.logMatch(input());
    expect(recorded[0].timestamp).toBeGreaterThanOrEqual(before);
    expect(recorded[0].timestamp).toBeLessThanOrEqual(Date.now());
  });

  it('honours a past playedAt', () => {
    const { provider, recorded } = harness();
    const playedAt = Date.now() - 90 * 60_000;
    provider.logMatch(input({ playedAt }));
    expect(recorded[0].timestamp).toBe(playedAt);
  });

  it('clamps a future playedAt to now (skewed clock cannot poison history)', () => {
    const { provider, recorded } = harness();
    provider.logMatch(input({ playedAt: Date.now() + 3_600_000 }));
    expect(recorded[0].timestamp).toBeLessThanOrEqual(Date.now());
  });
});

describe('logMatch — heroes & comms', () => {
  it('stores the multi-hero list verbatim', () => {
    const { provider, recorded } = harness();
    provider.logMatch(input({ heroes: ['Tracer', 'Widowmaker'] }));
    expect(recorded[0].heroes).toEqual(['Tracer', 'Widowmaker']);
  });

  it('falls back to the legacy single hero', () => {
    const { provider, recorded } = harness();
    provider.logMatch(input({ hero: 'Tracer' }));
    expect(recorded[0].heroes).toEqual(['Tracer']);
  });

  it('prefers heroes over a legacy hero when both are present', () => {
    const { provider, recorded } = harness();
    provider.logMatch(input({ hero: 'Tracer', heroes: ['Genji', 'Sombra'] }));
    expect(recorded[0].heroes).toEqual(['Genji', 'Sombra']);
  });

  it('records no heroes when none are given', () => {
    const { provider, recorded } = harness();
    provider.logMatch(input());
    expect(recorded[0].heroes).toEqual([]);
  });

  it('passes the comms tone through on the mental record', () => {
    const { provider, recorded } = harness();
    provider.logMatch(input({ mental: { comms: 'abusive' } }));
    expect(recorded[0].mental?.comms).toBe('abusive');
  });
});

describe('editMatch — hero list', () => {
  function editHarness(game: GameRecord) {
    const patches: Array<Partial<GameRecord>> = [];
    const deps = {
      history: {
        all: () => [game],
        editManual: (_id: string, patch: Partial<GameRecord>) => { patches.push(patch); },
      },
      getConfig: () => ({ accounts: { main: 'Main' } }),
    } as unknown as DataProviderDeps;
    return { provider: createDataProvider(deps), patches };
  }
  const manualGame = (heroes: string[]): GameRecord => ({
    matchId: 'manual-1', timestamp: 1, account: 'Main', role: 'damage', map: 'Ilios',
    result: 'Win', gameType: 'Competitive', source: 'manual', heroes,
  });

  it('edits the full multi-hero list without collapsing to the first hero', () => {
    const { provider, patches } = editHarness(manualGame(['Tracer', 'Genji']));
    provider.editMatch({ matchId: 'manual-1', heroes: ['Sombra', 'Sojourn', 'Ashe'] });
    expect(patches[0].heroes).toEqual(['Sombra', 'Sojourn', 'Ashe']);
  });

  it('clears the hero list with an empty array', () => {
    const { provider, patches } = editHarness(manualGame(['Tracer']));
    provider.editMatch({ matchId: 'manual-1', heroes: [] });
    expect(patches[0].heroes).toEqual([]);
  });

  it('still honours the legacy single hero field', () => {
    const { provider, patches } = editHarness(manualGame(['Tracer']));
    provider.editMatch({ matchId: 'manual-1', hero: 'Widowmaker' });
    expect(patches[0].heroes).toEqual(['Widowmaker']);
  });

  it('sets performance, and null clears it', () => {
    const { provider, patches } = editHarness(manualGame(['Tracer']));
    provider.editMatch({ matchId: 'manual-1', performance: 65 });
    expect(patches[0].performance).toBe(65);
    provider.editMatch({ matchId: 'manual-1', performance: null });
    expect(patches[1].performance).toBeNull();
  });

  it('leaves performance untouched when omitted', () => {
    const { provider, patches } = editHarness(manualGame(['Tracer']));
    provider.editMatch({ matchId: 'manual-1', map: 'Nepal' });
    expect(patches[0]).not.toHaveProperty('performance');
  });
});

describe('editMatch — Set current rank (back-compute)', () => {
  type Anchor = { account: string; role: Role; tier: string; division: number; progressPct: number; setAt: number };
  function rankHarness(game: GameRecord, seed: Anchor[] = []) {
    const patches: Array<Partial<GameRecord>> = [];
    const store: Record<string, Anchor> = {};
    for (const a of seed) store[rankKey(a.account, a.role)] = a;
    const deps = {
      history: { all: () => [game], editManual: (_id: string, patch: Partial<GameRecord>) => { patches.push(patch); } },
      rankAnchors: {
        get: (account: string, role: Role) => store[rankKey(account, role)],
        map: () => Object.fromEntries(Object.entries(store).map(([k, a]) =>
          [k, { tier: a.tier, division: a.division, progressPct: a.progressPct, setAt: a.setAt }])),
        set: (rec: Anchor) => { store[rankKey(rec.account, rec.role)] = rec; return rec; },
      },
      getConfig: () => ({ accounts: { main: 'Main' } }),
    } as unknown as DataProviderDeps;
    return { provider: createDataProvider(deps), patches, store };
  }
  const compGame = (role: Role = 'damage', timestamp = 1000): GameRecord => ({
    matchId: 'm-set', timestamp, account: 'Main', role, map: 'Ilios',
    result: 'Loss', gameType: 'Competitive', source: 'manual', heroes: [],
  });

  it('back-computes the SR % from the entered rank against the anchor', () => {
    // Anchor at the match instant → rank-before = the anchor (Gold 3 40%).
    const { provider, patches } = rankHarness(compGame(), [
      { account: 'Main', role: 'damage', tier: 'Gold', division: 3, progressPct: 40, setAt: 1000 },
    ]);
    // Entered Gold 2 10% (=1310 pts) − Gold 3 40% (=1240 pts) = +70.
    provider.editMatch({ matchId: 'm-set', setRank: { tier: 'Gold', division: 2, progressPct: 10 } });
    expect(patches[0].srDelta).toBe(70);
  });

  it('keys the back-compute on the NEW role when the same edit changes role', () => {
    // Both ladders anchored at the match instant; the edit moves the match to tank.
    const { provider, patches } = rankHarness(compGame('damage'), [
      { account: 'Main', role: 'damage', tier: 'Gold', division: 3, progressPct: 40, setAt: 1000 },
      { account: 'Main', role: 'tank', tier: 'Platinum', division: 2, progressPct: 30, setAt: 1000 },
    ]);
    // Must diff against the TANK anchor (Plat 2 30% = 1830), not damage:
    // entered Plat 2 50% (=1850) − 1830 = +20. (The old, buggy code diffed vs
    // the damage anchor 1240 and produced +610.)
    provider.editMatch({ matchId: 'm-set', role: 'tank', setRank: { tier: 'Platinum', division: 2, progressPct: 50 } });
    expect(patches[0].role).toBe('tank');
    expect(patches[0].srDelta).toBe(20);
  });

  it('bootstraps a fresh anchor (no srDelta) on the role the match lands on when none exists', () => {
    const { provider, patches, store } = rankHarness(compGame('damage'), []);
    provider.editMatch({ matchId: 'm-set', role: 'tank', setRank: { tier: 'Diamond', division: 3, progressPct: 50 } });
    // Anchor created for TANK (where the match now lives), at the match's timestamp.
    expect(store[rankKey('Main', 'tank')]).toMatchObject({
      role: 'tank', tier: 'Diamond', division: 3, progressPct: 50, setAt: 1000,
    });
    expect(store[rankKey('Main', 'damage')]).toBeUndefined();
    // Nothing before it to diff against → no srDelta derived.
    expect(patches[0]?.srDelta).toBeUndefined();
  });

  it('ignores setRank on a non-competitive match', () => {
    const { provider, patches, store } = rankHarness(
      { ...compGame('damage'), gameType: 'Quick Play' }, []);
    provider.editMatch({ matchId: 'm-set', setRank: { tier: 'Gold', division: 2, progressPct: 10 } });
    expect(patches[0]?.srDelta).toBeUndefined();
    expect(Object.keys(store)).toHaveLength(0); // no anchor bootstrapped
  });
});

describe('logMatch — performance', () => {
  it('stores a performance rating when given', () => {
    const { provider, recorded } = harness();
    provider.logMatch(input({ performance: 88 }));
    expect(recorded[0].performance).toBe(88);
  });

  it('omits performance when not given', () => {
    const { provider, recorded } = harness();
    provider.logMatch(input());
    expect(recorded[0].performance).toBeUndefined();
  });
});

describe('saveReview — performance', () => {
  function reviewHarness() {
    const reviews: Array<{ matchId: string; grades: unknown; flags: unknown }> = [];
    const patches: Array<{ matchId: string; patch: Partial<GameRecord> }> = [];
    const deps = {
      history: {
        setReview: (matchId: string, review: { grades: unknown; flags: unknown }) => {
          reviews.push({ matchId, ...review });
        },
        editManual: (matchId: string, patch: Partial<GameRecord>) => { patches.push({ matchId, patch }); },
      },
      getConfig: () => ({ accounts: { main: 'Main' } }),
    } as unknown as DataProviderDeps;
    return { provider: createDataProvider(deps), reviews, patches };
  }

  it('patches performance alongside the review when given', () => {
    const { provider, patches } = reviewHarness();
    provider.saveReview({ matchId: 'm1', grades: {}, flags: {}, performance: 40 });
    expect(patches).toEqual([{ matchId: 'm1', patch: { performance: 40 } }]);
  });

  it('does not touch performance when omitted', () => {
    const { provider, patches } = reviewHarness();
    provider.saveReview({ matchId: 'm1', grades: {}, flags: {} });
    expect(patches).toEqual([]);
  });
});

describe('mostPlayedHeroes', () => {
  it('ranks per account/role over the full history', () => {
    const games: GameRecord[] = [
      { matchId: '1', timestamp: 1, account: 'Main', role: 'damage', map: 'Ilios', result: 'Win', gameType: 'Competitive', heroes: ['Tracer'] },
      { matchId: '2', timestamp: 2, account: 'Main', role: 'damage', map: 'Ilios', result: 'Win', gameType: 'Competitive', heroes: ['Tracer'] },
      { matchId: '3', timestamp: 3, account: 'Main', role: 'damage', map: 'Ilios', result: 'Loss', gameType: 'Competitive', heroes: ['Genji'] },
    ];
    const deps = {
      history: { all: () => games },
      getConfig: () => ({ accounts: { main: 'Main' } }),
    } as unknown as DataProviderDeps;
    const provider = createDataProvider(deps);
    // openQ aggregates across every recorded role for the account — here that's
    // the same games as 'damage' since all three were logged as damage.
    expect(provider.mostPlayedHeroes()).toEqual({
      Main: { damage: ['Tracer', 'Genji'], openQ: ['Tracer', 'Genji'] },
    });
  });

  it('returns an empty object for no history', () => {
    const deps = {
      history: { all: () => [] },
      getConfig: () => ({ accounts: { main: 'Main' } }),
    } as unknown as DataProviderDeps;
    expect(createDataProvider(deps).mostPlayedHeroes()).toEqual({});
  });
});
