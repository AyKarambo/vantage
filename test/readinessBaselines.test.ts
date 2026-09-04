import { describe, it, expect } from 'vitest';
import {
  buildBaselines,
  baselineFor,
  heroMixOverlap,
  heroKey,
  qualifiesForPer10,
} from '../src/core/readiness/baselines';
import { dayOrdinal, READINESS_TUNING as T } from '../src/core/readiness';
import { playedMinutesOf } from '../src/core/playedTime';
import { ts, game, statSpan } from './readinessFixtures';

describe('qualifiesForPer10 (per-10 hygiene)', () => {
  const base = statSpan(10, 10, { perDay: 1 })[0]; // GEP-looking id, measured playedMinutes 10
  it('accepts a single-hero game with perHero stats and a usable played time', () => {
    expect(qualifiesForPer10(base)).toBe(true);
  });
  it('excludes multi-hero games (older captures record no per-hero playtime; one bucket must not mix eras)', () => {
    const multi = {
      ...base,
      heroes: ['Tracer', 'Sombra'],
      perHero: [base.perHero![0], { ...base.perHero![0], hero: 'Sombra' }],
    };
    expect(qualifiesForPer10(multi)).toBe(false);
  });
  it('excludes games with no usable time at all (nothing is fabricated)', () => {
    expect(qualifiesForPer10({ ...base, durationMinutes: undefined, playedMinutes: undefined })).toBe(false);
  });
  it('gates on PLAYED time: a 4-minute stomp is excluded whether measured or estimated', () => {
    expect(qualifiesForPer10({ ...base, playedMinutes: 4 })).toBe(false);
    expect(qualifiesForPer10({ ...base, durationMinutes: 4, playedMinutes: undefined })).toBe(false);
  });
  it('an older capture at the wall-clock bar estimates BELOW the bar (hero select + scoreboard are not play)', () => {
    // 6 wall-clock minutes on a Control map ⇒ ~4.5 played; a measured 6 played minutes qualifies.
    expect(qualifiesForPer10({ ...base, durationMinutes: T.minPer10Minutes, playedMinutes: undefined })).toBe(false);
    expect(qualifiesForPer10({ ...base, durationMinutes: T.minPer10Minutes, playedMinutes: T.minPer10Minutes })).toBe(true);
  });
  it('excludes games without perHero stats (manual logs)', () => {
    expect(qualifiesForPer10(game({ timestamp: ts(10), durationMinutes: 10, playedMinutes: 10 }))).toBe(false);
  });
});

describe('per-10 divisor is PLAYED time (shared playedTime helper)', () => {
  const base = statSpan(10, 10, { perDay: 1, damage: 8000 })[0];

  it('measured: scales by 10 / playedMinutes, not the wall clock', () => {
    const b = buildBaselines([{ ...base, durationMinutes: 12, playedMinutes: 8 }]);
    expect(b.qualifying).toHaveLength(1);
    expect(b.qualifying[0].per10.damage).toBeCloseTo(10000, 9); // 8000 over 8 played minutes
  });

  it('estimated: an older GEP capture without playedMinutes uses the same estimate every surface uses', () => {
    const older = { ...base, playedMinutes: undefined };
    const played = playedMinutesOf(older);
    expect(played).not.toBeNull();
    expect(played!).toBeLessThan(10); // the wall clock understates every rate
    const b = buildBaselines([older]);
    expect(b.qualifying[0].per10.damage).toBeCloseTo((8000 * 10) / played!, 9);
    expect(b.qualifying[0].per10.damage).toBeGreaterThan(8000);
  });

  it('reported: a hand-logged duration is taken as typed', () => {
    const manual = { ...base, matchId: 'manual-1', playedMinutes: undefined };
    const b = buildBaselines([manual]);
    expect(b.qualifying[0].per10.damage).toBe(8000);
  });
});

describe('buildBaselines', () => {
  it('buckets per ACCOUNT — a smurf never feeds the main baseline', () => {
    const main = statSpan(5, 20, { perDay: 2, account: 'Main', damage: 8000 });
    const smurf = statSpan(5, 20, { perDay: 2, account: 'Smurf', damage: 14000, hour: 18 });
    const b = buildBaselines([...main, ...smurf]);
    expect(b.heroBuckets.get(heroKey('Main', 'Tracer'))).toHaveLength(32);
    expect(b.heroBuckets.get(heroKey('Smurf', 'Tracer'))).toHaveLength(32);
    const mainBase = baselineFor(b.heroBuckets.get(heroKey('Main', 'Tracer')), dayOrdinal(ts(21)));
    expect(mainBase.metrics.damage.mean).toBe(8000); // untouched by the smurf's 14k
  });

  it('heroLifetime counts EVERY game listing the hero, including multi-hero ones', () => {
    const single = statSpan(5, 9, { perDay: 1 }); // 5 single-hero Tracer games
    const multi = [game({ timestamp: ts(10), heroes: ['Tracer', 'Sombra'] })];
    const b = buildBaselines([...single, ...multi]);
    expect(b.heroLifetime.get('Tracer')).toBe(6);
    expect(b.heroLifetime.get('Sombra')).toBe(1);
  });

  it("heroLifetime pools ACROSS accounts — hero experience is the player's, not the account's", () => {
    const main = statSpan(5, 9, { perDay: 1, hero: 'Genji', account: 'Main' }); // 5
    const alt = statSpan(5, 7, { perDay: 1, hero: 'Genji', account: 'Smurf', hour: 19 }); // 3
    const b = buildBaselines([...main, ...alt]);
    expect(b.heroLifetime.get('Genji')).toBe(8);
    // ...while the stat buckets stay strictly per account.
    expect(b.heroBuckets.get(heroKey('Main', 'Genji'))).toHaveLength(5);
    expect(b.heroBuckets.get(heroKey('Smurf', 'Genji'))).toHaveLength(3);
  });
});

describe('baselineFor (uncoupled trailing window)', () => {
  it('excludes games at/after the acute start — the acute window never feeds its own baseline', () => {
    const before = statSpan(5, 14, { perDay: 2, damage: 8000 });
    const acute = statSpan(15, 20, { perDay: 2, damage: 2000 }); // collapsed stats
    const b = buildBaselines([...before, ...acute]);
    const bl = baselineFor(b.heroBuckets.get(heroKey('Main', 'Tracer')), dayOrdinal(ts(15)));
    expect(bl.n).toBe(20);
    expect(bl.metrics.damage.mean).toBe(8000); // the collapse did not contaminate it
  });

  it('caps the window at baseWindowGames (most recent first)', () => {
    const many = statSpan(0, 29, { perDay: 2, damage: 8000 }); // 60 games
    const b = buildBaselines(many);
    const bl = baselineFor(b.heroBuckets.get(heroKey('Main', 'Tracer')), dayOrdinal(ts(30)));
    expect(bl.n).toBe(40);
  });

  it('empty bucket → n 0, zero means, no NaN', () => {
    const bl = baselineFor(undefined, 100);
    expect(bl.n).toBe(0);
    expect(Number.isNaN(bl.metrics.damage.mean)).toBe(false);
  });
});

describe('heroMixOverlap (mix-shift guard input)', () => {
  const mk = (heroes: string[]) =>
    heroes.map((hero, i) => ({
      ordinal: 0, timestamp: i, account: 'Main', hero, role: 'damage',
      per10: { eliminations: 0, deaths: 0, damage: 0, healing: 0 },
    }));
  it('identical mix → 1', () => {
    expect(heroMixOverlap(mk(['A', 'B']), mk(['A', 'B']))).toBe(1);
  });
  it('disjoint mix → 0', () => {
    expect(heroMixOverlap(mk(['A', 'A']), mk(['B', 'B']))).toBe(0);
  });
  it('half-shared mix → 0.5', () => {
    expect(heroMixOverlap(mk(['A', 'B']), mk(['A', 'C']))).toBe(0.5);
  });
  it('empty side → 0', () => {
    expect(heroMixOverlap([], mk(['A']))).toBe(0);
  });
});
