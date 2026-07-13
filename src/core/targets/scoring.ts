import { winLoss, type GameRecord, type TargetGrade } from '../analytics';
import { sampleTargets } from './sampleTargets';
import { NOTION_IMPROVEMENT_TARGET_ID } from './notionBookkeeping';
import { evaluateMeasured } from './measured';
import { targetLearningCurve } from './learningCurve';
import type { AuthoredTarget, TargetSummary } from './types';

/**
 * The real path for Improvement Targets: scores the player's own authored
 * targets against the Review-screen grades stored on their match history.
 */

/**
 * The Targets library shown on the dashboard: the player's own authored targets
 * when they have any (archived included — flagged via `archivedAt` so the
 * renderer can hide them behind a Restore affordance). With no authored targets
 * the sample library is shown ONLY in demo mode; a real user who has authored
 * none sees an honestly empty list (the renderer shows a create-your-first
 * empty state). Archiving every target must not resurrect the demo data.
 *
 * Defense-in-depth (spec B2): the hidden Notion bookkeeping id
 * ({@link NOTION_IMPROVEMENT_TARGET_ID}) is never listed or scored here, even
 * if it somehow ended up in `authored` — it is an internal id, not a
 * user-authored target.
 */
export function buildTargets(games: GameRecord[], demo: boolean, authored?: AuthoredTarget[]): TargetSummary[] {
  const visible = authored?.filter((t) => t.id !== NOTION_IMPROVEMENT_TARGET_ID);
  if (visible && visible.length) {
    const base = winLoss(games).winrate || 0.5;
    return [...visible]
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((t) => (t.mode === 'measured' ? measuredSummary(t, games, base) : authoredSummary(t, games, base)));
  }
  return demo ? sampleTargets(games) : [];
}

/**
 * Score an authored target from the Review-screen grades stored on the games.
 * An attempt is any grade for this target; a hit is a 'hit' grade ('partial'
 * counts as an attempt, not a hit). Win-splits fall back to the player's
 * baseline while a side has no games.
 */
function authoredSummary(t: AuthoredTarget, games: GameRecord[], base: number): TargetSummary {
  const graded = games
    .filter((g) => g.review?.grades[t.id] !== undefined)
    .sort((a, b) => a.timestamp - b.timestamp);
  const grades = graded.map((g) => g.review!.grades[t.id]);
  const hits = grades.filter((g) => g === 'hit').length;
  const hitGames = graded.filter((g) => g.review!.grades[t.id] === 'hit');
  const missGames = graded.filter((g) => g.review!.grades[t.id] !== 'hit');

  return {
    id: t.id,
    name: t.name,
    mode: t.mode,
    rule: t.rule,
    roleScope: t.roleScope,
    heroScope: t.heroScope,
    hitRate: grades.length ? hits / grades.length : 0,
    hits,
    attempts: grades.length,
    winWhenHit: hitGames.length ? winLoss(hitGames).winrate : base,
    winWhenMissed: missGames.length ? winLoss(missGames).winrate : base,
    spark: gradeSpark(grades),
    isActive: t.isActive,
    archivedAt: t.archivedAt,
    // The Focus Trend learning curve — live targets only (archived stay light).
    ...(t.archivedAt ? {} : { learning: targetLearningCurve(games, t) }),
  };
}

/**
 * Score a MEASURED target automatically from match stats — no Review grades
 * needed. Evaluates the rule against every match on/after the target's
 * `createdAt` that exposes the bound stat (`evaluateMeasured`); a match that
 * can't be measured is skipped (not an attempt). Stored `review.grades` for a
 * measured target are ignored here so the two grading paths can't double-count.
 */
function measuredSummary(t: AuthoredTarget, games: GameRecord[], base: number): TargetSummary {
  const scored = games
    .filter((g) => g.timestamp >= t.createdAt)
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((g) => ({ g, res: evaluateMeasured(g, t) }))
    .filter((x): x is { g: GameRecord; res: { grade: TargetGrade; value: number } } => x.res !== null);
  const grades = scored.map((x) => x.res.grade);
  const hits = grades.filter((g) => g === 'hit').length;
  const hitGames = scored.filter((x) => x.res.grade === 'hit').map((x) => x.g);
  const missGames = scored.filter((x) => x.res.grade !== 'hit').map((x) => x.g);

  return {
    id: t.id,
    name: t.name,
    mode: t.mode,
    rule: t.rule,
    roleScope: t.roleScope,
    heroScope: t.heroScope,
    hitRate: grades.length ? hits / grades.length : 0,
    hits,
    attempts: grades.length,
    winWhenHit: hitGames.length ? winLoss(hitGames).winrate : base,
    winWhenMissed: missGames.length ? winLoss(missGames).winrate : base,
    spark: gradeSpark(grades),
    isActive: t.isActive,
    archivedAt: t.archivedAt,
    // The Focus Trend learning curve — live targets only (archived stay light).
    ...(t.archivedAt ? {} : { learning: targetLearningCurve(games, t) }),
  };
}

/** Last-8 attempts chronologically (hit→1, partial→0.5, missed→0), left-padded with 0. */
function gradeSpark(grades: TargetGrade[]): number[] {
  const recent = grades.slice(-8).map((g) => (g === 'hit' ? 1 : g === 'partial' ? 0.5 : 0));
  return [...new Array<number>(8 - recent.length).fill(0), ...recent];
}
