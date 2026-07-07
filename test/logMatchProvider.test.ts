import { describe, it, expect, vi } from 'vitest';
import { createDataProvider, type DataProviderDeps } from '../src/main/dataProvider';
import type { GameRecord } from '../src/core/analytics';
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
