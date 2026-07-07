import { describe, it, expect } from 'vitest';
import { perfState } from '../src/core/readiness/performance';
import { computeReadiness, READINESS_TUNING as T, dayOrdinal, type ReadinessContext } from '../src/core/readiness';
import type { GameRecord, TargetGrade } from '../src/core/analytics';
import { NOTION_IMPROVEMENT_TARGET_ID } from '../src/core/targets';
import { ts, statSpan, graded, target } from './readinessFixtures';

const HEALTHY = { damage: 8000, deaths: 5, elims: 20 };
const COLLAPSED = { damage: 5500, deaths: 8, elims: 13 };

/** A declining week over an established baseline — the dampener's home turf. */
function decliningHistory(): GameRecord[] {
  return [
    ...statSpan(5, 28, { perDay: 3, ...HEALTHY, result: 'Win' }),
    ...statSpan(29, 35, { perDay: 4, ...COLLAPSED, result: 'Loss' }),
  ];
}

/** Grade the last `n` acute-window games with the given per-target grades. */
function gradeAcute(games: GameRecord[], fromDay: number, grades: Record<string, TargetGrade>, n = 99): GameRecord[] {
  let remaining = n;
  return games.map((g) => {
    if (g.timestamp >= ts(fromDay) && remaining > 0) {
      remaining -= 1;
      return graded(g, grades);
    }
    return g;
  });
}

const perfWith = (games: GameRecord[], ctx: ReadinessContext, fatigued = false) =>
  perfState([...games].sort((a, b) => a.timestamp - b.timestamp), dayOrdinal(ts(35)), ctx, fatigued);

describe('target-focus dampener', () => {
  const ctx: ReadinessContext = { targets: [target('t1', 3)] };

  it('active targets + hit evidence + no elevated tilt → penalty visibly dampened', () => {
    const plain = decliningHistory();
    const withGrades = gradeAcute(plain, 29, { t1: 'hit' }, 8);
    const undamped = perfWith(plain, { targets: [] });
    const damped = perfWith(withGrades, ctx);
    expect(damped.targetEvidence).toBe(true);
    expect(damped.dampened).toBe(true);
    expect(damped.delta).toBeGreaterThan(undamped.delta); // strictly softer
    // ...but never eliminated: still a real penalty.
    expect(damped.delta).toBeLessThan(0);
  });

  it('the dampening signal explains it on the summary', () => {
    const withGrades = gradeAcute(decliningHistory(), 29, { t1: 'hit' }, 8);
    const r = computeReadiness(withGrades, ts(35, 20), ctx);
    expect(r.signals.some((s) => s.key === 'target-focus')).toBe(true);
  });

  it('elevated tilt voids the dampener (fatigued bar)', () => {
    const withGrades = gradeAcute(decliningHistory(), 29, { t1: 'hit' }, 8);
    const calm = perfWith(withGrades, ctx, false);
    const tilted = perfWith(withGrades, ctx, true);
    expect(calm.dampened).toBe(true);
    expect(tilted.dampened).toBe(false);
    expect(tilted.delta).toBeLessThan(calm.delta);
  });

  it('no grades in the acute window → no dampening (no positive evidence)', () => {
    const p = perfWith(decliningHistory(), ctx);
    expect(p.targetEvidence).toBe(false);
    expect(p.dampened).toBe(false);
  });

  it('all-partial grades count at half credit and miss the 0.6 threshold; all-hit clears it', () => {
    const partial = perfWith(gradeAcute(decliningHistory(), 29, { t1: 'partial' }, 8), ctx);
    expect(partial.targetEvidence).toBe(false); // mean credit 0.5 < 0.6
    const hit = perfWith(gradeAcute(decliningHistory(), 29, { t1: 'hit' }, 8), ctx);
    expect(hit.targetEvidence).toBe(true);
  });

  it('needs dampMinGraded DISTINCT games: 10 targets graded on 4 games are still 4 games of evidence', () => {
    const tenTargets: ReadinessContext = { targets: Array.from({ length: 10 }, (_, i) => target(`t${i}`, 3)) };
    const grades = Object.fromEntries(tenTargets.targets.map((t) => [t.id, 'hit' as TargetGrade]));
    const fourGames = gradeAcute(decliningHistory(), 29, grades, 4);
    const p = perfWith(fourGames, tenTargets);
    expect(p.targetEvidence).toBe(false); // 4 < dampMinGraded(5)
  });

  it('ten trivial targets buy exactly the same dampening factor as one target (anti-farming)', () => {
    const one = perfWith(gradeAcute(decliningHistory(), 29, { t1: 'hit' }, 8), { targets: [target('t1', 3)] });
    const tenCtx: ReadinessContext = { targets: Array.from({ length: 10 }, (_, i) => target(`t${i}`, 3)) };
    const tenGrades = Object.fromEntries(tenCtx.targets.map((t) => [t.id, 'hit' as TargetGrade]));
    const ten = perfWith(gradeAcute(decliningHistory(), 29, tenGrades, 8), tenCtx);
    expect(ten.delta).toBe(one.delta);
  });

  it('inactive, archived, Notion-sentinel, and not-yet-created targets never count', () => {
    const dead: ReadinessContext = {
      targets: [
        target('off', 3, { isActive: false }),
        target('archived', 3, { archivedAt: ts(20) }),
        target(NOTION_IMPROVEMENT_TARGET_ID, 3),
        target('future', 60), // created after the reference day
      ],
    };
    const grades = Object.fromEntries(dead.targets.map((t) => [t.id, 'hit' as TargetGrade]));
    const p = perfWith(gradeAcute(decliningHistory(), 29, grades, 8), dead);
    expect(p.targetEvidence).toBe(false);
  });

  it('the load subscore is unaffected by the dampener', () => {
    const withGrades = gradeAcute(decliningHistory(), 29, { t1: 'hit' }, 8);
    const damped = computeReadiness(withGrades, ts(35, 20), ctx);
    const undamped = computeReadiness(decliningHistory(), ts(35, 20), { targets: [] });
    expect(damped.subscores.load.delta).toBe(undamped.subscores.load.delta);
    expect(damped.subscores.performance.delta).toBeGreaterThan(undamped.subscores.performance.delta);
  });

  it('trend: the dampener never applies to days before the target existed', () => {
    // Target created day 33; grades only on days 33-35. The trend point for day
    // 31 (mid-decline, pre-target) must be identical with and without the ctx.
    const lateCtx: ReadinessContext = { targets: [target('late', 33)] };
    const games = gradeAcute(decliningHistory(), 33, { late: 'hit' }, 12);
    const withCtx = computeReadiness(games, ts(35, 20), lateCtx);
    const without = computeReadiness(decliningHistory(), ts(35, 20), { targets: [] });
    const day31 = (r: typeof withCtx) => r.trend.find((p) => p.date === withCtx.trend[withCtx.trend.length - 5].date);
    expect(day31(withCtx)?.score).toBe(day31(without)?.score);
  });
});
