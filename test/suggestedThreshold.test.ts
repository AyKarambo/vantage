import { describe, it, expect } from 'vitest';
import type { GameRecord, HeroStat } from '../src/core/analytics';
import type { Result } from '../src/core/model';
import { suggestMeasuredThreshold, roundToStep } from '../src/core/targets';

let seq = 0;
function game(p: Partial<GameRecord> = {}): GameRecord {
  seq += 1;
  return {
    matchId: `m-${seq}`,
    timestamp: 2000 + seq,
    account: 'Main',
    role: 'damage',
    map: 'Ilios',
    result: 'Win' as Result,
    gameType: 'Competitive',
    heroes: ['Tracer'],
    ...(p.durationMinutes != null ? { playedMinutes: p.durationMinutes } : {}),
    ...p,
  };
}
function hero(p: Partial<HeroStat> = {}): HeroStat {
  return { hero: 'Tracer', role: 'damage', eliminations: 0, deaths: 0, assists: 0, damage: 0, healing: 0, mitigation: 0, ...p };
}

describe('suggestMeasuredThreshold', () => {
  it('returns the median and 75th percentile of per-10 damage over qualifying games', () => {
    // Per-10 damage values: 6000, 8000, 10000, 12000, 14000 (odd count, exact median)
    const games = [6000, 8000, 10000, 12000, 14000].map((dmg) =>
      game({ durationMinutes: 10, perHero: [hero({ damage: dmg })] }),
    );
    const s = suggestMeasuredThreshold(games, 'Damage', 'Main');
    expect(s).not.toBeNull();
    expect(s!.median).toBe(10000);
    expect(s!.n).toBe(5);
    // p75 (numpy-style linear interpolation) of [6k,8k,10k,12k,14k] = 12000.
    expect(s!.p75).toBe(12000);
  });

  it('only considers the given account — a smurf never inflates the main account\'s suggestion', () => {
    const main = game({ account: 'Main', durationMinutes: 10, perHero: [hero({ damage: 10000 })] });
    const alt = game({ account: 'Alt', durationMinutes: 10, perHero: [hero({ damage: 20000 })] });
    const s = suggestMeasuredThreshold([main, alt], 'Damage', 'Main');
    expect(s!.median).toBe(10000);
    expect(s!.n).toBe(1);
  });

  it('honors role/hero scope via the same matchStatValue the target itself grades with', () => {
    const tankGame = game({ role: 'tank', durationMinutes: 10, perHero: [hero({ role: 'tank', damage: 3000 })] });
    const dpsGame = game({ role: 'damage', durationMinutes: 10, perHero: [hero({ role: 'damage', damage: 9000 })] });
    const s = suggestMeasuredThreshold([tankGame, dpsGame], 'Damage', 'Main', { roleScope: 'damage' });
    expect(s!.n).toBe(1);
    expect(s!.median).toBe(9000);
  });

  it('skips games that can\'t measure the stat — no duration, no perHero — rather than treating them as zero', () => {
    const measurable = game({ durationMinutes: 10, perHero: [hero({ damage: 10000 })] });
    const noDuration = game({ perHero: [hero({ damage: 5000 })] }); // no durationMinutes → unmeasurable
    const noStats = game({ durationMinutes: 10 }); // no perHero at all
    const s = suggestMeasuredThreshold([measurable, noDuration, noStats], 'Damage', 'Main');
    expect(s!.n).toBe(1);
    expect(s!.median).toBe(10000);
  });

  it('looks back over the last `window` games by recency, not the last `window` measured values', () => {
    // 5 old, unmeasurable games, then 3 recent, measurable ones — window=3
    // should see only the 3 recent games, not reach further back to find data.
    const old = Array.from({ length: 5 }, (_, i) => game({ timestamp: 100 + i })); // unmeasurable, no perHero
    const recent = [8000, 9000, 10000].map((dmg, i) =>
      game({ timestamp: 1000 + i, durationMinutes: 10, perHero: [hero({ damage: dmg })] }),
    );
    const s = suggestMeasuredThreshold([...old, ...recent], 'Damage', 'Main', {}, 3);
    expect(s!.n).toBe(3);
    expect(s!.median).toBe(9000);
  });

  it('returns null when nothing qualifies at all — a brand-new account, or zero coverage for the stat', () => {
    expect(suggestMeasuredThreshold([], 'Damage', 'Main')).toBeNull();
    const unmeasurable = game({ account: 'Main' }); // no duration, no perHero
    expect(suggestMeasuredThreshold([unmeasurable], 'Damage', 'Main')).toBeNull();
  });

  it('KDA is the ratio, not a per-10 rate, and still resolves without a duration', () => {
    const g = game({ perHero: [hero({ eliminations: 8, assists: 4, deaths: 2 })] }); // (8+4)/2 = 6
    const s = suggestMeasuredThreshold([g], 'KDA', 'Main');
    expect(s!.median).toBe(6);
  });
});

describe('roundToStep', () => {
  it('rounds a per-10 damage suggestion to the nearest 250 (its wheel step)', () => {
    expect(roundToStep(8247, 'Damage')).toBe(8250);
    expect(roundToStep(8124, 'Damage')).toBe(8000);
  });

  it('rounds KDA to the nearest 0.1', () => {
    expect(roundToStep(2.34, 'KDA')).toBeCloseTo(2.3, 5);
  });

  it('rounds a count stat (Deaths/Eliminations/Assists) to the nearest whole number', () => {
    expect(roundToStep(3.6, 'Deaths')).toBe(4);
    expect(roundToStep(3.4, 'Deaths')).toBe(3);
  });
});
