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
