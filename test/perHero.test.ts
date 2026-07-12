import { describe, it, expect } from 'vitest';
import { mergeHeroStats, heroLines, effectiveHeroMinutes } from '../src/core/perHero';
import type { HeroStat } from '../src/core/model';

const stat = (p: Partial<HeroStat> & { hero: string }): HeroStat => ({
  role: 'damage', eliminations: 0, deaths: 0, assists: 0, damage: 0, healing: 0, mitigation: 0, ...p,
});

describe('mergeHeroStats', () => {
  it('collapses same-hero segments, summing counting stats and minutes, first-seen order', () => {
    const merged = mergeHeroStats([
      stat({ hero: 'Tracer', eliminations: 10, deaths: 2, assists: 3, damage: 4000, minutes: 4 }),
      stat({ hero: 'Genji', eliminations: 8, deaths: 3, assists: 2, damage: 5000, minutes: 3 }),
      stat({ hero: 'Tracer', eliminations: 5, deaths: 1, assists: 1, damage: 2000, minutes: 1 }),
    ]);
    expect(merged.map((s) => s.hero)).toEqual(['Tracer', 'Genji']);
    expect(merged[0]).toMatchObject({
      hero: 'Tracer', eliminations: 15, deaths: 3, assists: 4, damage: 6000, minutes: 5,
    });
    expect(merged[1]).toMatchObject({ hero: 'Genji', eliminations: 8, minutes: 3 });
  });

  it('is idempotent on already-merged input', () => {
    const once = mergeHeroStats([stat({ hero: 'Ana', minutes: 9 }), stat({ hero: 'Ana', minutes: 1 })]);
    expect(mergeHeroStats(once)).toEqual(once);
  });

  it('keeps the first role seen and sums minutes even when the first segment lacked them', () => {
    const merged = mergeHeroStats([
      stat({ hero: 'Echo', role: undefined }),
      stat({ hero: 'Echo', role: 'damage', minutes: 6 }),
    ]);
    expect(merged[0].role).toBe('damage');
    expect(merged[0].minutes).toBe(6);
  });
});

describe('effectiveHeroMinutes', () => {
  it('prefers real recorded minutes', () => {
    expect(effectiveHeroMinutes(stat({ hero: 'Tracer', minutes: 5 }), 2, 12)).toBe(5);
  });
  it('falls back to an equal split of the match duration', () => {
    expect(effectiveHeroMinutes(stat({ hero: 'Tracer' }), 4, 20)).toBe(5);
  });
  it('is null (→ dash) when the match duration is unknown or rounds to 0', () => {
    expect(effectiveHeroMinutes(stat({ hero: 'Tracer', minutes: 5 }), 1, undefined)).toBeNull();
    expect(effectiveHeroMinutes(stat({ hero: 'Tracer', minutes: 5 }), 1, 0)).toBeNull();
  });
});

describe('heroLines', () => {
  it('computes per-10 from real minutes and KDA as a ratio', () => {
    const [line] = heroLines([stat({ hero: 'Tracer', eliminations: 20, assists: 10, deaths: 4, damage: 300, minutes: 5 })], 15);
    expect(line.per10?.damage).toBe(600); // 300 * 10 / 5
    expect(line.per10?.eliminations).toBe(40); // 20 * 10 / 5
    expect(line.kda).toBeCloseTo((20 + 10) / 4); // ratio, not per-10
    expect(line.minutes).toBe(5);
  });

  it('equal-splits the match duration when no per-hero minutes are recorded', () => {
    const lines = heroLines([
      stat({ hero: 'Tracer', damage: 100 }),
      stat({ hero: 'Genji', damage: 100 }),
    ], 20); // 10 min each
    expect(lines[0].minutes).toBe(10);
    expect(lines[0].per10?.damage).toBe(100); // 100 * 10 / 10
  });

  it('dashes per-10 counting stats but still yields KDA when duration is 0/undefined', () => {
    const [zero] = heroLines([stat({ hero: 'Tracer', eliminations: 6, assists: 2, deaths: 2, minutes: 3 })], 0);
    expect(zero.per10).toBeNull();
    expect(zero.kda).toBeCloseTo((6 + 2) / 2);
    const [none] = heroLines([stat({ hero: 'Tracer', eliminations: 6, assists: 2, deaths: 0 })], undefined);
    expect(none.per10).toBeNull();
    expect(none.kda).toBe(8); // deaths floored to 1
  });

  it('merges duplicates before computing lines', () => {
    const lines = heroLines([
      stat({ hero: 'Tracer', damage: 200, minutes: 2 }),
      stat({ hero: 'Genji', damage: 500, minutes: 5 }),
      stat({ hero: 'Tracer', damage: 400, minutes: 3 }),
    ], 10);
    expect(lines.map((l) => l.hero)).toEqual(['Tracer', 'Genji']);
    expect(lines[0].per10?.damage).toBe(1200); // (200+400) * 10 / (2+3)
  });
});
