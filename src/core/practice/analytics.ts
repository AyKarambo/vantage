import { dayKey, dayPartAt, winLoss, type GameRecord, type TargetGrade } from '../analytics';
import type { SessionCheckIn } from '../checkIn';
import { DEFAULT_COACHING, type CoachingSettings } from '../coachingSettings';
import { isTilted } from '../mental';
import { COST_MIN_SAMPLE, type TiltBucket } from '../mentalAnalytics';
import { gameContexts, PRACTICE_SITTING_GAP_MINUTES, sittingsOf, type GameContext } from './sittings';
import { round1 } from '../num';

/**
 * Practice reads for Mental and Review (issue #321): how often the player did
 * what they set out to do, and how the way they went into a session (sleep,
 * energy, mood, food, breaks) lines up with how they actually played. Only
 * self-rated grades count — those are the player's own "did I do it" reads;
 * measured targets grade every game automatically, so they say nothing about
 * what the player chose to practise. Pure and I/O-free.
 */

/** Hit / Partial / Missed counts over self-rated grades, plus the execution score. */
export interface ExecutionTally {
  hits: number;
  partials: number;
  misses: number;
  attempts: number;
  /** (hits + ½·partials) / attempts, 0..1; null with no attempts. */
  score: number | null;
}

const EMPTY_TALLY: ExecutionTally = { hits: 0, partials: 0, misses: 0, attempts: 0, score: null };

function addGrade(t: ExecutionTally, grade: TargetGrade): void {
  t.attempts += 1;
  if (grade === 'hit') t.hits += 1;
  else if (grade === 'partial') t.partials += 1;
  else t.misses += 1;
}

function finish(t: ExecutionTally): ExecutionTally {
  return { ...t, score: t.attempts ? (t.hits + t.partials / 2) / t.attempts : null };
}

/** The execution tally over every self-rated grade (`selfIds`) on `games`. */
export function executionOf(games: readonly GameRecord[], selfIds: ReadonlySet<string>): ExecutionTally {
  const t = { ...EMPTY_TALLY };
  for (const g of games) {
    for (const [id, grade] of Object.entries(g.review?.grades ?? {})) {
      if (selfIds.has(id)) addGrade(t, grade);
    }
  }
  return finish(t);
}

/** The execution tally per self-rated target over `games` — the "Your active targets" rows. */
export function executionByTarget(games: readonly GameRecord[], selfIds: ReadonlySet<string>): Record<string, ExecutionTally> {
  const out: Record<string, ExecutionTally> = {};
  for (const g of games) {
    for (const [id, grade] of Object.entries(g.review?.grades ?? {})) {
      if (selfIds.has(id)) addGrade(out[id] ??= { ...EMPTY_TALLY }, grade);
    }
  }
  for (const id of Object.keys(out)) out[id] = finish(out[id]);
  return out;
}

/** One sitting's execution, for the Session quality bars. */
export interface SittingExecution {
  startedAt: number;
  endedAt: number;
  score: number;
  attempts: number;
  wins: number;
  losses: number;
  draws: number;
}

/**
 * Execution per sitting — the newest `limit` sittings (oldest first) that
 * have at least one graded game among the `include`d ones. Sittings are cut
 * over the full history; `include` only scopes which games aggregate.
 */
export function sittingExecution(
  all: readonly GameRecord[],
  include: ReadonlySet<string>,
  selfIds: ReadonlySet<string>,
  limit = 8,
): SittingExecution[] {
  const out: SittingExecution[] = [];
  for (const sitting of sittingsOf(all)) {
    const games = sitting.filter((g) => include.has(g.matchId));
    const t = executionOf(games, selfIds);
    if (!games.length || t.score === null) continue;
    const wl = winLoss(games);
    out.push({
      startedAt: games[0].timestamp, endedAt: games[games.length - 1].timestamp,
      score: t.score, attempts: t.attempts, wins: wl.wins, losses: wl.losses, draws: wl.draws,
    });
  }
  return out.slice(-limit);
}

/** The factors the "What shapes your performance" table splits by. ◎ from the check-in, ⚡ tracked. */
export type FactorKey = 'sleep' | 'energy' | 'mood' | 'ate' | 'breaks' | 'position';

/** One level of one factor, with how those games actually went. */
export interface FactorRow {
  key: string;
  games: number;
  /** Execution over the row's games; null when none were graded. */
  execution: number | null;
  attempts: number;
  /** Mean "How you played" (0–100) over the rated games; null when none were rated. */
  avgRating: number | null;
  rated: number;
  winrate: number;
  decided: number;
}

export interface FactorEntry {
  key: FactorKey;
  source: 'checkIn' | 'tracked';
  rows: FactorRow[];
}

/** Display order of each factor's levels (best-sounding first) and their copy. */
export const FACTOR_LEVELS: Record<FactorKey, Array<{ key: string; label: string }>> = {
  sleep: [{ key: 'good', label: 'Slept well' }, { key: 'ok', label: 'Slept OK' }, { key: 'poor', label: 'Slept poorly' }],
  energy: [{ key: 'sharp', label: 'Sharp' }, { key: 'ok', label: 'OK' }, { key: 'foggy', label: 'Foggy' }],
  mood: [{ key: 'calm', label: 'Calm' }, { key: 'edgy', label: 'Edgy' }, { key: 'tilted', label: 'Tilted' }],
  ate: [{ key: 'yes', label: 'Ate properly' }, { key: 'no', label: 'Didn’t eat' }],
  breaks: [{ key: 'tookBreak', label: 'Took a break' }, { key: 'noBreak4', label: 'No break, 4+ games' }],
  position: [{ key: '1-3', label: 'Game 1–3' }, { key: '4+', label: 'Game 4+' }],
};

export const FACTOR_LABELS: Record<FactorKey, string> = {
  sleep: 'Sleep', energy: 'Energy', mood: 'Mood', ate: 'Food', breaks: 'Breaks', position: 'Game # in sitting',
};

/** Which level of `factor` a game falls in, or null when it has none (e.g. no check-in). */
function levelOf(factor: FactorKey, ctx: GameContext): string | null {
  const c = ctx.checkIn;
  switch (factor) {
    case 'sleep': return c?.sleep ?? null;
    case 'energy': return c?.energy ?? null;
    case 'mood': return c?.mood ?? null;
    case 'ate': return c?.ate === undefined ? null : c.ate ? 'yes' : 'no';
    case 'breaks': return ctx.afterBreak ? 'tookBreak' : ctx.position >= 4 ? 'noBreak4' : null;
    case 'position': return ctx.position <= 3 ? '1-3' : '4+';
  }
}

function factorRow(key: string, games: readonly GameRecord[], selfIds: ReadonlySet<string>): FactorRow {
  const t = executionOf(games, selfIds);
  const rated = games.filter((g) => typeof g.performance === 'number');
  const wl = winLoss([...games]);
  return {
    key,
    games: games.length,
    execution: t.score,
    attempts: t.attempts,
    avgRating: rated.length ? round1(rated.reduce((a, g) => a + g.performance!, 0) / rated.length) : null,
    rated: rated.length,
    winrate: wl.winrate,
    decided: wl.wins + wl.losses,
  };
}

/**
 * The "What shapes your performance" table over the `include`d games: for
 * every factor, one row per level that has games. A check-in applies to every
 * game of the sitting it preceded. Factors without any rows are left out, so a
 * player who never answers the optional questions just doesn't see them.
 */
export function factorTable(
  all: readonly GameRecord[],
  include: ReadonlySet<string>,
  checkIns: readonly SessionCheckIn[],
  settings: CoachingSettings,
  selfIds: ReadonlySet<string>,
): FactorEntry[] {
  const ctxs = gameContexts(all, checkIns, settings);
  const games = all.filter((g) => include.has(g.matchId));
  const out: FactorEntry[] = [];
  for (const factor of Object.keys(FACTOR_LEVELS) as FactorKey[]) {
    const byLevel = new Map<string, GameRecord[]>();
    for (const g of games) {
      const ctx = ctxs.get(g.matchId);
      const level = ctx ? levelOf(factor, ctx) : null;
      if (level !== null) (byLevel.get(level) ?? byLevel.set(level, []).get(level)!).push(g);
    }
    const rows = FACTOR_LEVELS[factor]
      .filter((l) => byLevel.has(l.key))
      .map((l) => factorRow(l.key, byLevel.get(l.key)!, selfIds));
    if (rows.length) out.push({ key: factor, source: factor === 'breaks' || factor === 'position' ? 'tracked' : 'checkIn', rows });
  }
  return out;
}

/** Self-rating points two levels of a factor must differ by before the headline names it. */
export const HEADLINE_MIN_GAP = 10;

/** The factor with the biggest "How you played" gap between two of its levels. */
export interface FactorHeadline {
  factor: FactorKey;
  /** The level you played best at, and worst at. */
  high: FactorRow;
  low: FactorRow;
  /** high.avgRating − low.avgRating, 1 decimal. */
  gap: number;
}

/**
 * The one sentence over the factor table: the factor whose best and worst
 * levels (each with ≥ {@link COST_MIN_SAMPLE} rated games) are furthest apart
 * in "How you played" — only when that gap is at least {@link HEADLINE_MIN_GAP}.
 * A correlation, never a cause.
 */
export function factorHeadline(table: readonly FactorEntry[]): FactorHeadline | null {
  let best: FactorHeadline | null = null;
  for (const f of table) {
    const sampled = f.rows.filter((r) => r.rated >= COST_MIN_SAMPLE && r.avgRating !== null);
    if (sampled.length < 2) continue;
    const sorted = [...sampled].sort((a, b) => b.avgRating! - a.avgRating!);
    const gap = round1(sorted[0].avgRating! - sorted[sorted.length - 1].avgRating!);
    if (gap >= HEADLINE_MIN_GAP && (!best || gap > best.gap)) {
      best = { factor: f.key, high: sorted[0], low: sorted[sorted.length - 1], gap };
    }
  }
  return best;
}

/** One of the weakest days, with plain facts about it. */
export interface WeakDay {
  /** UTC day key (YYYY-MM-DD), the shared day-bucketing convention. */
  date: string;
  games: number;
  avgRating: number;
  execution: number | null;
  wins: number;
  losses: number;
  /** Plain facts about the day — check-in answers, longest run without a break, time of day. No judgement. */
  tags: string[];
}

/** Rated games a day needs before it can be one of the weakest. */
export const WEAK_DAY_MIN_RATED = 3;

const SLEEP_TAG: Record<string, string> = { poor: 'slept poor', ok: 'slept OK', good: 'slept well' };
const ENERGY_TAG: Record<string, string> = { foggy: 'foggy', ok: 'energy OK', sharp: 'sharp' };
const MOOD_TAG: Record<string, string> = { calm: 'calm check-in', edgy: 'edgy check-in', tilted: 'tilted check-in' };

/**
 * The up-to-`limit` days in range with the lowest average "How you played"
 * (each needing ≥ {@link WEAK_DAY_MIN_RATED} rated games), weakest first.
 * Tags only state what was so that day; the player draws the conclusion.
 */
export function weakestDays(
  all: readonly GameRecord[],
  include: ReadonlySet<string>,
  checkIns: readonly SessionCheckIn[],
  settings: CoachingSettings,
  selfIds: ReadonlySet<string>,
  limit = 3,
): WeakDay[] {
  const ctxs = gameContexts(all, checkIns, settings);
  const byDay = new Map<string, GameRecord[]>();
  for (const g of all) {
    if (!include.has(g.matchId)) continue;
    const key = dayKey(g.timestamp);
    (byDay.get(key) ?? byDay.set(key, []).get(key)!).push(g);
  }
  const days: WeakDay[] = [];
  for (const [date, games] of byDay) {
    const rated = games.filter((g) => typeof g.performance === 'number');
    if (rated.length < WEAK_DAY_MIN_RATED) continue;
    const wl = winLoss(games);
    days.push({
      date,
      games: games.length,
      avgRating: round1(rated.reduce((a, g) => a + g.performance!, 0) / rated.length),
      execution: executionOf(games, selfIds).score,
      wins: wl.wins,
      losses: wl.losses,
      tags: dayTags(games, ctxs),
    });
  }
  return days.sort((a, b) => a.avgRating - b.avgRating || (a.date < b.date ? 1 : -1)).slice(0, limit);
}

function dayTags(games: readonly GameRecord[], ctxs: ReadonlyMap<string, GameContext>): string[] {
  const tags: string[] = [];
  const add = (t: string | undefined): void => { if (t && !tags.includes(t)) tags.push(t); };
  for (const g of games) {
    const c = ctxs.get(g.matchId)?.checkIn;
    if (!c) continue;
    add(c.sleep && SLEEP_TAG[c.sleep]);
    add(c.energy && ENERGY_TAG[c.energy]);
    add(MOOD_TAG[c.mood]);
    if (c.ate !== undefined) add(c.ate ? 'ate properly' : 'didn’t eat');
  }
  const longest = Math.max(0, ...games.map((g) => ctxs.get(g.matchId)?.run ?? 0));
  if (longest >= 4) add(`no break in ${longest} games`);
  const parts = new Map<string, number>();
  for (const g of games) {
    const p = dayPartAt(new Date(g.timestamp).getHours());
    parts.set(p, (parts.get(p) ?? 0) + 1);
  }
  const top = [...parts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (top) add(top[0].toLowerCase());
  return tags;
}

/** The Review screen's recap of a fully reviewed sitting. */
export interface SittingRecap {
  matchIds: string[];
  /** The sitting is over (no game within the gap since its last one); while false the recap reads "so far". */
  closed: boolean;
  startedAt: number;
  endedAt: number;
  games: number;
  execution: ExecutionTally;
  /** Mean "How you played" over the sitting's rated games; null when none were rated. */
  avgRating: number | null;
  checkIn?: SessionCheckIn;
  wins: number;
  losses: number;
  draws: number;
  /** Sum of logged SR deltas; absent when the sitting logged none. */
  srDelta?: number;
  /** The player's execution over their whole history, to compare the sitting against. */
  overallScore: number | null;
}

/**
 * The newest sitting in which every game has a review and at least one
 * self-rated grade was given — the moment the Review screen can say how the
 * practice went. Null when there is none. Over the unfiltered history.
 */
export function sittingRecap(
  all: readonly GameRecord[],
  checkIns: readonly SessionCheckIn[],
  selfIds: ReadonlySet<string>,
  now: number = Date.now(),
): SittingRecap | null {
  const sittings = sittingsOf(all);
  const sortedCheckIns = [...checkIns].sort((a, b) => a.at - b.at);
  for (let i = sittings.length - 1; i >= 0; i--) {
    const s = sittings[i];
    if (!s.every((g) => g.review)) continue;
    const execution = executionOf(s, selfIds);
    if (!execution.attempts) continue;
    const rated = s.filter((g) => typeof g.performance === 'number');
    const wl = winLoss(s);
    const sr = s.map((g) => g.srDelta).filter((v): v is number => v != null);
    const ctx = gameContexts(s, sortedCheckIns, DEFAULT_COACHING).get(s[0].matchId);
    return {
      matchIds: s.map((g) => g.matchId),
      closed: now - s[s.length - 1].timestamp > PRACTICE_SITTING_GAP_MINUTES * 60_000,
      startedAt: s[0].timestamp,
      endedAt: s[s.length - 1].timestamp,
      games: s.length,
      execution,
      avgRating: rated.length ? round1(rated.reduce((a, g) => a + g.performance!, 0) / rated.length) : null,
      ...(ctx?.checkIn ? { checkIn: ctx.checkIn } : {}),
      wins: wl.wins,
      losses: wl.losses,
      draws: wl.draws,
      ...(sr.length ? { srDelta: sr.reduce((a, b) => a + b, 0) } : {}),
      overallScore: executionOf(all, selfIds).score,
    };
  }
  return null;
}

/**
 * Tilt rate split by one optional check-in answer (sleep or energy) over every
 * game of the sittings a check-in preceded — the stats-mode "When do I tilt"
 * rows. Levels without games are omitted; order follows {@link FACTOR_LEVELS}.
 */
export function tiltByCheckInField(
  all: readonly GameRecord[],
  include: ReadonlySet<string>,
  checkIns: readonly SessionCheckIn[],
  field: 'sleep' | 'energy',
): TiltBucket[] {
  const ctxs = gameContexts(all, checkIns, DEFAULT_COACHING, PRACTICE_SITTING_GAP_MINUTES);
  const byLevel = new Map<string, GameRecord[]>();
  for (const g of all) {
    if (!include.has(g.matchId)) continue;
    const level = ctxs.get(g.matchId)?.checkIn?.[field];
    if (level) (byLevel.get(level) ?? byLevel.set(level, []).get(level)!).push(g);
  }
  return FACTOR_LEVELS[field].filter((l) => byLevel.has(l.key)).map((l) => {
    const gs = byLevel.get(l.key)!;
    const tilted = gs.filter((g) => isTilted(g)).length;
    return { key: l.key, games: gs.length, tilted, rate: tilted / gs.length };
  });
}

/** Everything Mental and Review need for the practice layer, on the dashboard payload. */
export interface PracticeSummary {
  /** Whether practice mode is on (settings + active targets). */
  on: boolean;
  /** Execution over the filtered range. */
  execution: ExecutionTally;
  /** Execution over the previous window of the same length, when there is one. */
  prevExecution?: ExecutionTally;
  sittings: SittingExecution[];
  factors: FactorEntry[];
  headline?: FactorHeadline;
  weakestDays: WeakDay[];
  /** The newest fully reviewed sitting; Review shows it once one of its games was graded this session. */
  recap?: SittingRecap;
  /** Execution per target over the range (self-rated targets with at least one grade), keyed by target id. */
  byTarget: Record<string, ExecutionTally>;
  /** What Log Match pre-selects for a game logged right now (stickiness + check-in, like an inbox row's `suggestedFocus`). */
  nextFocus: string[];
}
