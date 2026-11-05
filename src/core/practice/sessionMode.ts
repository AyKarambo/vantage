import type { GameRecord, TargetGrade } from '../analytics';

/**
 * Session mode (issue #342): an explicit, player-picked switch between
 * **Stats** (the default — Matches leads with win/loss, exactly as before)
 * and **Training** (the sitting is about drilling a target, so Matches leads
 * with target execution and hides win/loss). Never inferred from having
 * active targets. Each match recorded while Training is on is stamped
 * `sessionMode: 'training'` when it is persisted, so history keeps showing
 * every sitting the way it was played. Win/loss is still tracked: rank,
 * readiness and Trends never read the mode. Pure and I/O-free.
 */

export type SessionMode = 'stats' | 'training';

/** The persisted switch: which mode, and when the player last flipped it. */
export interface SessionModeState {
  mode: SessionMode;
  /** Epoch ms of the last change; 0 when never changed. Drives the auto-reset. */
  since: number;
}

export const DEFAULT_SESSION_MODE: SessionModeState = { mode: 'stats', since: 0 };

/** Coerce an untrusted (IPC / config file) value into a valid state. */
export function normalizeSessionMode(raw: unknown): SessionModeState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const mode: SessionMode = r.mode === 'training' ? 'training' : 'stats';
  const since = typeof r.since === 'number' && Number.isFinite(r.since) && r.since > 0 ? Math.round(r.since) : 0;
  return { mode, since };
}

/**
 * The mode in effect at `now`. Training stays on until the player turns it
 * off — unless `autoReset` is set (Settings › Coaching, off by default), in
 * which case it lapses back to Stats once a new sitting starts: the first
 * pause longer than `gapMinutes` anywhere in the activity since Training was
 * switched on (the switch itself, then each recorded match end, then `now`).
 * Derived rather than written back, so the read is the same in every process
 * and a later stats game can't revive a lapsed Training session.
 */
export function effectiveSessionMode(
  state: SessionModeState,
  opts: { autoReset: boolean; gapMinutes: number; now: number; matchTimes?: readonly number[] },
): SessionMode {
  if (state.mode !== 'training') return 'stats';
  if (!opts.autoReset || !state.since) return 'training';
  const gapMs = opts.gapMinutes * 60_000;
  const times = (opts.matchTimes ?? []).filter((t) => t > state.since && t <= opts.now).sort((a, b) => a - b);
  let prev = state.since;
  for (const t of [...times, opts.now]) {
    if (t - prev > gapMs) return 'stats';
    prev = t;
  }
  return 'training';
}

/**
 * Stamp a game that is about to be persisted with the mode in effect. Only
 * Training is written — a stats game carries no stamp, exactly like every
 * game recorded before the mode existed — and a stamp already on the record
 * (a re-recorded or imported game) is never overwritten.
 */
export function stampSessionMode<T extends Pick<GameRecord, 'sessionMode'>>(game: T, mode: SessionMode): T {
  if (mode !== 'training' || game.sessionMode) return game;
  return { ...game, sessionMode: 'training' };
}

/** Whether a game / row was played as a training match. */
export function isTrainingMatch(m: { sessionMode?: string }): boolean {
  return m.sessionMode === 'training';
}

/** Execution weight per grade: Hit 1, Partial ½, Miss 0 — the same scale `executionOf` uses. */
const GRADE_VALUE: Record<TargetGrade, number> = { hit: 1, partial: 0.5, missed: 0 };

/**
 * One match's execution score — the performance indicator of a training
 * match (Hit 1 / Partial ½ / Miss 0, averaged over its graded focus
 * targets). Null when nothing is graded yet.
 */
export function executionScore(grades: Iterable<TargetGrade>): number | null {
  let sum = 0;
  let n = 0;
  for (const g of grades) {
    sum += GRADE_VALUE[g];
    n += 1;
  }
  return n ? sum / n : null;
}

/** What a Matches training sitting / day header shows instead of `W–L · ±SR`. */
export interface TrainingSummary {
  /** Training games in the group. */
  games: number;
  /** Training games with at least one graded self-rated target. */
  graded: number;
  hits: number;
  partials: number;
  misses: number;
  attempts: number;
  /** Execution over every grade in the group (Hit 1 / Partial ½ / Miss 0); null with no grades. */
  score: number | null;
  /** The targets drilled, most-graded first (ties: first seen). */
  targetIds: string[];
}

/**
 * The execution summary of a group of training rows: every self-rated grade
 * (ids in `selfIds`) across them, plus which targets were worked on. Rows
 * without a training stamp are ignored, so a mixed day can pass all its rows.
 */
export function trainingSummary(
  rows: ReadonlyArray<{ sessionMode?: string; targetGrades?: Record<string, TargetGrade> }>,
  selfIds: ReadonlySet<string>,
): TrainingSummary {
  const out: TrainingSummary = { games: 0, graded: 0, hits: 0, partials: 0, misses: 0, attempts: 0, score: null, targetIds: [] };
  const perTarget = new Map<string, number>();
  const all: TargetGrade[] = [];
  for (const r of rows) {
    if (!isTrainingMatch(r)) continue;
    out.games += 1;
    const graded = Object.entries(r.targetGrades ?? {}).filter(([id]) => selfIds.has(id));
    if (graded.length) out.graded += 1;
    for (const [id, grade] of graded) {
      perTarget.set(id, (perTarget.get(id) ?? 0) + 1);
      all.push(grade);
      if (grade === 'hit') out.hits += 1;
      else if (grade === 'partial') out.partials += 1;
      else out.misses += 1;
    }
  }
  out.attempts = all.length;
  out.score = executionScore(all);
  out.targetIds = [...perTarget.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  return out;
}

/** A group's rows split by how they were played, order kept. */
export function splitByMode<T extends { sessionMode?: string }>(rows: readonly T[]): { training: T[]; stats: T[] } {
  const training: T[] = [];
  const stats: T[] = [];
  for (const r of rows) (isTrainingMatch(r) ? training : stats).push(r);
  return { training, stats };
}

/**
 * Whether the Training toggle can be switched on: it needs at least one
 * active, non-archived SELF-RATED target to drill (measured targets grade
 * themselves, so there is nothing to practise and grade by hand).
 */
export function canTrain(targets: ReadonlyArray<{ isActive: boolean; archivedAt?: number; mode?: string }>): boolean {
  return targets.some((t) => t.isActive && !t.archivedAt && t.mode !== 'measured');
}

/** The Current session card's training read: the sitting's execution, game by game. */
export interface SessionTraining extends TrainingSummary {
  /** Graded training games whose every focus target was a Hit (execution score 1). */
  hitGames: number;
}

/**
 * The training read for the sidebar's Current session card, or null when it
 * should keep its stats read. Looks at the trailing sitting (the same gap rule
 * as `currentSession`; null once it has closed) and answers when it has a
 * training match and either its latest match was played in Training or
 * Training is on now — so a stats sitting, and a Stats-mode session, read
 * exactly as before.
 */
export function sessionTraining(
  games: readonly GameRecord[],
  selfIds: ReadonlySet<string>,
  opts: { now: number; gapMinutes: number; mode: SessionMode },
): SessionTraining | null {
  if (!games.length) return null;
  const sorted = [...games].sort((a, b) => a.timestamp - b.timestamp);
  const gapMs = opts.gapMinutes * 60_000;
  let sitting: GameRecord[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].timestamp - sorted[i - 1].timestamp > gapMs) sitting = [];
    sitting.push(sorted[i]);
  }
  const last = sitting[sitting.length - 1];
  if (opts.now - last.timestamp > gapMs) return null;
  if (!sitting.some(isTrainingMatch) || (!isTrainingMatch(last) && opts.mode !== 'training')) return null;
  const rows = sitting.map((g) => ({ sessionMode: g.sessionMode, targetGrades: g.review?.grades }));
  const hitGames = rows.filter((r) => {
    if (!isTrainingMatch(r)) return false;
    const grades = Object.entries(r.targetGrades ?? {}).filter(([id]) => selfIds.has(id)).map(([, g]) => g);
    return executionScore(grades) === 1;
  }).length;
  return { ...trainingSummary(rows, selfIds), hitGames };
}
