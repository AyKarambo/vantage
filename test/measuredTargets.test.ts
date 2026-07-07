import { describe, it, expect } from 'vitest';
import type { GameRecord, HeroStat, MatchReview, TargetGrade } from '../src/core/analytics';
import type { Result } from '../src/core/model';
import {
  buildTargets, parseMeasuredRule, matchStatValue, evaluateMeasured,
  foldMeasuredGradesForExport, effectiveImprovementGrade, matchExportSignature,
  TARGET_TEMPLATES, type AuthoredTarget,
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

describe('evaluateMeasured — Hit / Partial / Missed bands (m = 10%)', () => {
  it('≥ grades hit / partial / missed', () => {
    const t = target('Damage ≥ 9000');
    expect(evaluateMeasured(game({ durationMinutes: 10, perHero: [hero({ damage: 11240 })] }), t))
      .toEqual({ grade: 'hit', value: 11240 });
    expect(evaluateMeasured(game({ durationMinutes: 10, perHero: [hero({ damage: 8500 })] }), t)?.grade)
      .toBe('partial'); // ≥ 8100
    expect(evaluateMeasured(game({ durationMinutes: 10, perHero: [hero({ damage: 7000 })] }), t)?.grade)
      .toBe('missed');
  });
  it('≤ grades hit / partial / missed', () => {
    const t = target('Deaths ≤ 3');
    // 3 deaths / 10 min → 3.0 → hit
    expect(evaluateMeasured(game({ durationMinutes: 10, perHero: [hero({ deaths: 3 })] }), t)?.grade).toBe('hit');
    // 4 deaths / 12.5 min → 3.2 → ≤ 3.3 → partial
    expect(evaluateMeasured(game({ durationMinutes: 12.5, perHero: [hero({ deaths: 4 })] }), t)?.grade).toBe('partial');
    // 4 deaths / 10 min → 4.0 → missed
    expect(evaluateMeasured(game({ durationMinutes: 10, perHero: [hero({ deaths: 4 })] }), t)?.grade).toBe('missed');
  });
  it('returns null (skip) when the match cannot be measured', () => {
    expect(evaluateMeasured(game({ durationMinutes: 10 }), target('Damage ≥ 9000'))).toBeNull();
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
});
