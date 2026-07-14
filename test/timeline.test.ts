import { describe, it, expect } from 'vitest';
import { targetTimeline } from '../src/core/targets';
import type { AuthoredTarget } from '../src/core/targets';
import type { GameRecord } from '../src/core/analytics';
import type { Result } from '../src/core/model';

let seq = 0;

describe('targetTimeline', () => {
  it('self-rated: every game, ascending, with a grade only where the user graded it', () => {
    const t: AuthoredTarget = { id: 'S', name: '', mode: 'self', rule: '', createdAt: 0, isActive: true };
    const g = (ts: number, result: Result, grade?: 'hit' | 'partial' | 'missed'): GameRecord => ({
      matchId: `m${++seq}`, timestamp: ts, account: 'M', role: 'damage', map: 'Ilios',
      result, gameType: 'Competitive', heroes: ['Tracer'],
      ...(grade ? { review: { at: 0, grades: { S: grade }, flags: {} } } : {}),
    });
    const tl = targetTimeline([g(3, 'Win', 'hit'), g(1, 'Loss'), g(2, 'Win', 'missed')], t);
    expect(tl.map((a) => a.timestamp)).toEqual([1, 2, 3]); // sorted ascending
    expect(tl.map((a) => a.grade)).toEqual([undefined, 'missed', 'hit']);
  });

  it('measured: only games where evaluateMeasured resolves (inside the hero scope)', () => {
    const t: AuthoredTarget = {
      id: 'M', name: '', mode: 'measured', rule: 'Eliminations ≥ 10', heroScope: 'Tracer',
      createdAt: 0, isActive: true,
    };
    const g = (ts: number, hero: string, elim: number): GameRecord => ({
      matchId: `m${++seq}`, timestamp: ts, account: 'M', role: 'damage', map: 'Ilios',
      result: 'Win', gameType: 'Competitive', heroes: [hero], durationMinutes: 10,
      perHero: [{ hero, role: 'damage', eliminations: elim, deaths: 0, assists: 0, damage: 0, healing: 0, mitigation: 0 }],
    });
    const tl = targetTimeline([g(1, 'Tracer', 12), g(2, 'Ana', 5), g(3, 'Tracer', 6)], t);
    expect(tl.map((a) => a.timestamp)).toEqual([1, 3]); // the off-hero (Ana) game is excluded
    expect(tl[0].grade).toBe('hit'); // 12 elim/10 ≥ 10
    expect(tl[0].value).toBe(12);
    expect(tl[1].grade).toBe('missed'); // 6 elim/10 < 8 (20% band) — still in scope → it counts
  });
});
