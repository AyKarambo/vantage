import { winLoss, type GameRecord, type TargetGrade } from '../analytics';
import { sampleTargets } from './sampleTargets';
import type { AuthoredTarget, TargetSummary } from './types';

/**
 * The real path for Improvement Targets: scores the player's own authored
 * targets against the Review-screen grades stored on their match history.
 */

/**
 * The Targets library shown on the dashboard: the player's own authored targets
 * when they have any (archived included — flagged via `archivedAt` so the
 * renderer can hide them behind a Restore affordance), otherwise the sample
 * library (demo mode). Archiving every target must not resurrect the demo data.
 */
export function buildTargets(games: GameRecord[], authored?: AuthoredTarget[]): TargetSummary[] {
  if (authored && authored.length) {
    const base = winLoss(games).winrate || 0.5;
    return [...authored].sort((a, b) => b.createdAt - a.createdAt).map((t) => authoredSummary(t, games, base));
  }
  return sampleTargets(games);
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
    hitRate: grades.length ? hits / grades.length : 0,
    hits,
    attempts: grades.length,
    winWhenHit: hitGames.length ? winLoss(hitGames).winrate : base,
    winWhenMissed: missGames.length ? winLoss(missGames).winrate : base,
    spark: gradeSpark(grades),
    isActive: t.isActive,
    archivedAt: t.archivedAt,
  };
}

/** Last-8 attempts chronologically (hit→1, partial→0.5, missed→0), left-padded with 0. */
function gradeSpark(grades: TargetGrade[]): number[] {
  const recent = grades.slice(-8).map((g) => (g === 'hit' ? 1 : g === 'partial' ? 0.5 : 0));
  return [...new Array<number>(8 - recent.length).fill(0), ...recent];
}
