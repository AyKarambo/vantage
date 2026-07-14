import { describe, it, expect } from 'vitest';
import type { GameRecord, HeroStat, MatchReview, TargetGrade } from '../src/core/analytics';
import type { Result } from '../src/core/model';
import {
  buildTargets, parseMeasuredRule, matchStatValue, evaluateMeasured,
  foldMeasuredGradesForExport, effectiveImprovementGrade, matchExportSignature,
  targetLearningCurve, TARGET_TEMPLATES, type AuthoredTarget,
} from '../src/core/targets';

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
    ...p,
  };
}
function hero(p: Partial<HeroStat> = {}): HeroStat {
  return { hero: 'Tracer', role: 'damage', eliminations: 0, deaths: 0, assists: 0, damage: 0, healing: 0, mitigation: 0, ...p };
}
function target(rule: string, p: Partial<AuthoredTarget> = {}): AuthoredTarget {
  return { id: 't', name: 't', mode: 'measured', rule, createdAt: 0, isActive: true, ...p };
}
function review(grades: Record<string, TargetGrade>): MatchReview {
  return { at: 0, grades, flags: {} };
}

describe('parseMeasuredRule', () => {
  it('parses stat/op/value and strips commas', () => {
    expect(parseMeasuredRule('Damage ≥ 9,000')).toEqual({ stat: 'Damage', op: '≥', value: 9000 });
    expect(parseMeasuredRule('Deaths ≤ 3')).toEqual({ stat: 'Deaths', op: '≤', value: 3 });
  });
  it('returns null for a non-measured rule', () => {
    expect(parseMeasuredRule('You grade it')).toBeNull();
  });
  it('round-trips every measured template', () => {
    for (const t of TARGET_TEMPLATES.filter((x) => x.mode === 'measured')) {
      expect(parseMeasuredRule(t.rule)).not.toBeNull();
    }
  });
});

describe('matchStatValue — per-10 / ratio', () => {
  it('computes a per-10-minute rate for volume stats', () => {
    const g = game({ durationMinutes: 10, perHero: [hero({ damage: 11240 })] });
    expect(matchStatValue(g, 'Damage')).toBe(11240);
    const g2 = game({ durationMinutes: 20, perHero: [hero({ damage: 11240 })] });
    expect(matchStatValue(g2, 'Damage')).toBe(5620);
  });
  it('sums per-hero rows', () => {
    const g = game({ durationMinutes: 10, perHero: [hero({ damage: 6000 }), hero({ damage: 5240 })] });
    expect(matchStatValue(g, 'Damage')).toBe(11240);
  });
  it('computes KDA as a ratio without needing a duration', () => {
    const g = game({ perHero: [hero({ eliminations: 10, assists: 5, deaths: 5 })] });
    expect(matchStatValue(g, 'KDA')).toBe(3);
  });
  it('returns null when there are no per-hero stats', () => {
    expect(matchStatValue(game({ durationMinutes: 10 }), 'Damage')).toBeNull();
  });
  it('returns null for a rate stat with no duration', () => {
    expect(matchStatValue(game({ perHero: [hero({ damage: 9000 })] }), 'Damage')).toBeNull();
  });
});

describe('matchStatValue — role/hero scope (D)', () => {
  // A 20-minute Bastion + Tracer match: equal-split → 10 minutes each hero.
  const multi = (): GameRecord =>
    game({
      role: 'damage',
      durationMinutes: 20,
      perHero: [
        hero({ hero: 'Bastion', role: 'damage', damage: 40000 }),
        hero({ hero: 'Tracer', role: 'damage', damage: 12000 }),
      ],
    });

  it('an empty scope object is identical to no scope (unscoped unchanged)', () => {
    const g = multi();
    expect(matchStatValue(g, 'Damage', {})).toBe(matchStatValue(g, 'Damage'));
    expect(matchStatValue(g, 'Damage')).toBe(26000); // (40000 + 12000) × 10 / 20
  });

  it('hero scope measures only that hero over its own minutes', () => {
    // Tracer: 12000 damage over its 10 equal-split minutes → 12000 per 10.
    expect(matchStatValue(multi(), 'Damage', { heroScope: 'Tracer' })).toBe(12000);
  });

  it('hero scope folds casing / accents / punctuation via heroMatchKey', () => {
    expect(matchStatValue(multi(), 'Damage', { heroScope: 'tracer' })).toBe(12000);
  });

  it('a match with no in-scope hero is skipped (null), never a miss', () => {
    const g = game({ durationMinutes: 20, perHero: [hero({ hero: 'Bastion', role: 'damage', damage: 40000 })] });
    expect(matchStatValue(g, 'Damage', { heroScope: 'Tracer' })).toBeNull();
  });

  it('role scope counts only that role’s heroes', () => {
    const g = game({
      role: 'support',
      durationMinutes: 20,
      perHero: [
        hero({ hero: 'Ana', role: 'support', healing: 10000, damage: 3000 }),
        hero({ hero: 'Genji', role: 'damage', healing: 0, damage: 9000 }),
      ],
    });
    // Support scope → Ana only (10 min): 10000 healing → 10000 per 10.
    expect(matchStatValue(g, 'Healing', { roleScope: 'support' })).toBe(10000);
    // Damage scope → Genji only (10 min): 9000 damage → 9000 per 10.
    expect(matchStatValue(g, 'Damage', { roleScope: 'damage' })).toBe(9000);
  });

  it('a role-scoped target skips open-queue matches (but hero-only scope still applies)', () => {
    const g = game({ role: 'openQ', durationMinutes: 20, perHero: [hero({ hero: 'Ana', role: 'support', healing: 10000 })] });
    expect(matchStatValue(g, 'Healing', { roleScope: 'support' })).toBeNull();
    // 10000 healing over the single hero's 20 min → 5000 per 10.
    expect(matchStatValue(g, 'Healing', { heroScope: 'Ana' })).toBe(5000);
  });

  it('a contradictory role+hero combo matches no row → permanently skipped', () => {
    const g = game({ durationMinutes: 20, perHero: [hero({ hero: 'Tracer', role: 'damage', damage: 12000 })] });
    expect(matchStatValue(g, 'Damage', { roleScope: 'support', heroScope: 'Tracer' })).toBeNull();
  });

  it('a role-scoped target skips rows whose role GEP never reported', () => {
    const g = game({ durationMinutes: 20, perHero: [hero({ hero: 'Tracer', role: undefined, damage: 12000 })] });
    expect(matchStatValue(g, 'Damage', { roleScope: 'damage' })).toBeNull();
  });
});

describe('evaluateMeasured — Hit / Partial / Missed bands (default m = 20%)', () => {
  it('≥ grades hit / partial / missed', () => {
    const t = target('Damage ≥ 9000');
    expect(evaluateMeasured(game({ durationMinutes: 10, perHero: [hero({ damage: 11240 })] }), t))
      .toEqual({ grade: 'hit', value: 11240 });
    expect(evaluateMeasured(game({ durationMinutes: 10, perHero: [hero({ damage: 8500 })] }), t)?.grade)
      .toBe('partial'); // ≥ 7200 (9000 × 0.8)
    expect(evaluateMeasured(game({ durationMinutes: 10, perHero: [hero({ damage: 7000 })] }), t)?.grade)
      .toBe('missed'); // < 7200
  });
  it('≤ grades hit / partial / missed', () => {
    const t = target('Deaths ≤ 3');
    // 3 deaths / 10 min → 3.0 → hit
    expect(evaluateMeasured(game({ durationMinutes: 10, perHero: [hero({ deaths: 3 })] }), t)?.grade).toBe('hit');
    // 4 deaths / 12.5 min → 3.2 → ≤ 3.6 (3 × 1.2) → partial
    expect(evaluateMeasured(game({ durationMinutes: 12.5, perHero: [hero({ deaths: 4 })] }), t)?.grade).toBe('partial');
    // 4 deaths / 10 min → 4.0 → missed
    expect(evaluateMeasured(game({ durationMinutes: 10, perHero: [hero({ deaths: 4 })] }), t)?.grade).toBe('missed');
  });
  it('returns null (skip) when the match cannot be measured', () => {
    expect(evaluateMeasured(game({ durationMinutes: 10 }), target('Damage ≥ 9000'))).toBeNull();
  });

  it('threads the target’s scope so a scoped target grades a different value', () => {
    const g = game({
      durationMinutes: 20,
      perHero: [
        hero({ hero: 'Bastion', role: 'damage', damage: 40000 }),
        hero({ hero: 'Tracer', role: 'damage', damage: 12000 }),
      ],
    });
    // Unscoped 26000 ≥ 20000 → hit; scoped to Tracer (12000) → below 16000 (20% band) → missed.
    expect(evaluateMeasured(g, target('Damage ≥ 20000'))?.grade).toBe('hit');
    expect(evaluateMeasured(g, target('Damage ≥ 20000', { heroScope: 'Tracer' }))?.grade).toBe('missed');
  });

  it('honours a caller-supplied margin, widening/tightening the partial band', () => {
    const t = target('Damage ≥ 10000');
    const g = game({ durationMinutes: 10, perHero: [hero({ damage: 8500 })] }); // 8500 per 10
    expect(evaluateMeasured(g, t)?.grade).toBe('partial');       // default 20% → band [8000,10000)
    expect(evaluateMeasured(g, t, 0.1)?.grade).toBe('missed');   // 10% → band [9000,10000)
    expect(evaluateMeasured(g, t, 0.3)?.grade).toBe('partial');  // 30% → band [7000,10000)
  });
});

describe('foldMeasuredGradesForExport', () => {
  const t = target('Damage ≥ 9000');
  it('replaces a measured id with its derived grade, leaving other grades intact', () => {
    const g = game({ durationMinutes: 10, perHero: [hero({ damage: 11240 })] });
    expect(foldMeasuredGradesForExport({ other: 'missed', t: 'missed' }, [t], g))
      .toEqual({ other: 'missed', t: 'hit' });
  });
  it('deletes a measured id when the match cannot measure it (no stale grade leaks)', () => {
    const g = game({ durationMinutes: 10 }); // no perHero
    expect(foldMeasuredGradesForExport({ t: 'hit' }, [t], g)).toEqual({});
  });
  it('ignores self-rated targets', () => {
    const self = target('You grade it', { id: 's', mode: 'self' });
    const g = game({ durationMinutes: 10, perHero: [hero({ damage: 11240 })] });
    expect(foldMeasuredGradesForExport({ s: 'partial' }, [self], g)).toEqual({ s: 'partial' });
  });
});

describe('effectiveImprovementGrade — export signature reflects measured grades', () => {
  it('folds a measured target into the exported aggregate', () => {
    const g = game({ durationMinutes: 10, perHero: [hero({ damage: 11240 })] });
    expect(effectiveImprovementGrade(g, [target('Damage ≥ 9000')], new Set(['t']))).toBe('hit');
  });
  it('a rule edit that flips a past match grade flips the export signature (change detected)', () => {
    const g = game({ durationMinutes: 10, perHero: [hero({ damage: 11240 })] });
    const easy = effectiveImprovementGrade(g, [target('Damage ≥ 9000')], new Set(['t'])); // hit
    const hard = effectiveImprovementGrade(g, [target('Damage ≥ 12000')], new Set(['t'])); // missed
    expect(easy).not.toBe(hard);
    expect(matchExportSignature(g, easy)).not.toBe(matchExportSignature(g, hard));
  });

  // D5: editing a target's SCOPE re-derives the grade, so the export signature
  // flips and the affected exported match goes unsynced — same mechanism as a
  // rule edit, driven purely by the scope fields.
  it('a scope edit that flips a match grade flips the export signature (change detected)', () => {
    const g = game({
      durationMinutes: 20,
      perHero: [
        hero({ hero: 'Bastion', role: 'damage', damage: 40000 }),
        hero({ hero: 'Tracer', role: 'damage', damage: 12000 }),
      ],
    });
    const global = effectiveImprovementGrade(g, [target('Damage ≥ 15000')], new Set(['t'])); // hit
    const scoped = effectiveImprovementGrade(g, [target('Damage ≥ 15000', { heroScope: 'Tracer' })], new Set(['t'])); // 12000 → partial (20% band)
    expect(global).not.toBe(scoped);
    expect(matchExportSignature(g, global)).not.toBe(matchExportSignature(g, scoped));
  });

  it('honors the partial margin so the exported grade matches the in-app one', () => {
    const g = game({ durationMinutes: 10, perHero: [hero({ damage: 8500 })] }); // 8500 vs 10000
    const t = target('Damage ≥ 10000');
    const wide = effectiveImprovementGrade(g, [t], new Set(['t']), 0.2); // partial
    const tight = effectiveImprovementGrade(g, [t], new Set(['t']), 0.1); // missed
    expect(wide).not.toBe(tight);
    expect(matchExportSignature(g, wide)).not.toBe(matchExportSignature(g, tight));
  });
});

describe('buildTargets — measured targets auto-grade from stats', () => {
  it('scores from stats, only on/after createdAt, skipping unmeasurable matches', () => {
    const t = target('Damage ≥ 9000', { createdAt: 1000 });
    const games = [
      game({ timestamp: 2000, result: 'Win', durationMinutes: 10, perHero: [hero({ damage: 11240 })] }), // hit
      game({ timestamp: 2001, result: 'Loss', durationMinutes: 10, perHero: [hero({ damage: 7000 })] }), // missed
      game({ timestamp: 500, result: 'Win', durationMinutes: 10, perHero: [hero({ damage: 20000 })] }), // before createdAt → skipped
      game({ timestamp: 2002, result: 'Win' }), // no perHero → skipped
    ];
    const [s] = buildTargets(games, false, [t]);
    expect(s.attempts).toBe(2);
    expect(s.hits).toBe(1);
    expect(s.hitRate).toBe(0.5);
    expect(s.winWhenHit).toBe(1);
    expect(s.winWhenMissed).toBe(0);
  });

  it('ignores any stored review grade on a measured target id', () => {
    const t = target('Damage ≥ 9000', { createdAt: 0 });
    const games = [
      game({ result: 'Win', durationMinutes: 10, perHero: [hero({ damage: 11240 })], review: review({ t: 'missed' }) }),
    ];
    const [s] = buildTargets(games, false, [t]);
    expect(s.hits).toBe(1); // derived hit wins over the stored 'missed'
    expect(s.attempts).toBe(1);
  });

  it('threads the partial margin into the Focus Trend points (measured grade labels)', () => {
    const t = target('Damage ≥ 10000', { createdAt: 0, activatedAt: 0 });
    const games = [
      ...Array.from({ length: 5 }, (_, i) => game({ timestamp: 100 + i, durationMinutes: 10, perHero: [hero({ damage: 12000 })] })),
      game({ timestamp: 200, durationMinutes: 10, perHero: [hero({ damage: 8500 })] }), // boundary: 8500 vs 10000
    ];
    const gradeAt200 = (margin: number): string | undefined =>
      targetLearningCurve(games, t, margin).points.find((p) => p.timestamp === 200)?.grade;
    expect(gradeAt200(0.2)).toBe('partial'); // 20% band → ≥ 8000
    expect(gradeAt200(0.1)).toBe('missed');  // 10% band → ≥ 9000
  });

  it('threads the partial margin into the spark (partial vs missed)', () => {
    const t = target('Damage ≥ 10000', { createdAt: 0 });
    const games = [game({ durationMinutes: 10, perHero: [hero({ damage: 8500 })] })]; // 8500 per 10
    expect(buildTargets(games, false, [t])[0].spark.at(-1)).toBe(0.5);      // 20% → partial
    expect(buildTargets(games, false, [t], 0.1)[0].spark.at(-1)).toBe(0);   // 10% → missed
  });

  it('scopes auto-grading to a single hero and round-trips the scope onto the summary', () => {
    const t = target('Damage ≥ 15000', { createdAt: 0, heroScope: 'Tracer' });
    const games = [
      game({
        result: 'Win', durationMinutes: 20,
        perHero: [hero({ hero: 'Bastion', role: 'damage', damage: 40000 }), hero({ hero: 'Tracer', role: 'damage', damage: 20000 })],
      }), // Tracer 20000 per 10 → hit
      game({
        result: 'Loss', durationMinutes: 20,
        perHero: [hero({ hero: 'Bastion', role: 'damage', damage: 40000 })],
      }), // no Tracer → skipped
    ];
    const [s] = buildTargets(games, false, [t]);
    expect(s.attempts).toBe(1);
    expect(s.hits).toBe(1);
    expect(s.heroScope).toBe('Tracer'); // D1 round-trip through scoring.ts
    expect(s.roleScope).toBeUndefined();
  });
});
