/**
 * Played time — the minutes a player could actually FIGHT in a match, which is
 * the divisor every per-10-minute stat should use.
 *
 * A match's wall clock (`match_start` → `match_end`) includes time nobody can
 * play: the "Assemble your team" hero select before the first round, each
 * round's setup lock (attackers behind spawn doors on Escort/Hybrid, the
 * round-change overlay on Control), and the Victory/Defeat lineup + Play of the
 * Game + scoreboard after the last round. Dividing by the wall clock therefore
 * understates every per-10 rate against what the game's own career profile
 * shows. Real GEP captures (2026-09) measured the parts outside the rounds:
 * `match_start` → first `round_start` 28.0–29.4 s in every match, last
 * `round_end` → `match_end` 35–51 s; no stat accrued in either window.
 *
 * Two paths, one answer:
 *  - MEASURED: newer captures carry {@link GameRecord.playedMinutes} (and the
 *    rounds it came from), computed by the aggregator from the round events
 *    with the per-mode setup lock already removed ({@link playWindowsOf}).
 *  - ESTIMATED: older GEP captures only have the wall clock. The same phases
 *    are subtracted as calibrated constants ({@link PLAYED_TIME_ESTIMATE}) plus
 *    the mode's setup locks for a typical competitive round count, so old and
 *    new games stay comparable inside one baseline.
 *  - REPORTED: hand-logged durations are taken as typed — a person writing
 *    "12 min" is not counting the scoreboard.
 *
 * Pure and Electron-free; imported by the aggregator, core analytics, readiness,
 * measured targets and match detail. The renderer never imports it — it reads
 * the resulting `playedMinutes` / `playedSource` off the IPC contract.
 */
import type { GameRecord, HeroStat } from './analytics/types';
import type { RoundSpan } from './model';
import { mapMode as staticMapMode, type MapMode } from './maps';
import { mergeHeroStats } from './perHero';
import { sourceOf } from './source';

/**
 * Map name → mode. The built-in table by default; callers that hold the user's
 * map catalog (the aggregator, the dashboard, match detail) pass that instead.
 *
 * KNOWN LIMIT: surfaces with no catalog in reach — measured-target grading and
 * the readiness baselines — resolve through the built-in table. The two only
 * disagree for a map the built-in table has never heard of (one the user added,
 * or a brand-new official map pulled in by the online update) AND only on
 * legacy records that need the estimate at all, since a measured record already
 * carries its played minutes. Even then it is silent for Push, Flashpoint and
 * Clash, whose setup locks are zero either way.
 */
export type MapModeResolver = (map: string) => MapMode;

/** Non-play windows OUTSIDE the GEP rounds, measured from real captures (seconds). */
export const PLAYED_TIME_ESTIMATE = {
  /** `match_start` → first `round_start`: the hero-select / "Assemble your team" phase. Captures: 28.0–29.4 s. */
  preRoundSeconds: 28,
  /** Last `round_end` → `match_end`: Victory/Defeat lineup, Play of the Game, scoreboard. Captures: 35–51 s. */
  postMatchSeconds: 40,
  /** An estimate never drops below this share of the wall clock (a 4-minute stomp is still mostly play). */
  minPlayedFraction: 0.4,
  /** …nor below this many minutes. */
  minPlayedMinutes: 1,
} as const;

/**
 * Seconds INSIDE a round during which nobody can fight, per game mode:
 * `first` for the opening round, `later` for every round after it. Only phases
 * where the fight is physically impossible count — free-roam unlock timers
 * (Control's 30 s point unlock, Push's robot lock, Flashpoint/Clash captures)
 * are fightable and stay in.
 *  - Escort/Hybrid: the 45 s setup lock (attackers behind doors); a later round
 *    also carries the 25 s side-switch "Assemble" inside the GEP round.
 *  - Control: doors open at round start; later rounds begin behind the ~15 s
 *    round-change overlay.
 * Sources: Overwatch wiki mode pages + the 2018-10-09 / 2020-02-25 patch notes.
 */
export const ROUND_SETUP_SECONDS: Record<MapMode, { first: number; later: number }> = {
  Escort: { first: 45, later: 70 },
  Hybrid: { first: 45, later: 70 },
  Control: { first: 0, later: 15 },
  Push: { first: 0, later: 0 },
  Flashpoint: { first: 0, later: 0 },
  Clash: { first: 0, later: 0 },
  Unknown: { first: 0, later: 0 },
};

/**
 * Typical competitive round count per mode, for estimates on captures that
 * recorded no rounds. Control is a best-of-three (2 or 3 rounds → 2.5 on
 * average); Escort/Hybrid play both sides in Competitive; the rest are one round.
 */
export const DEFAULT_ROUNDS: Record<MapMode, number> = {
  Escort: 2,
  Hybrid: 2,
  Control: 2.5,
  Push: 1,
  Flashpoint: 1,
  Clash: 1,
  Unknown: 1,
};

/** The setup lock of round `index` (0-based) for `mode`, in seconds. */
export function roundSetupSeconds(mode: MapMode, index: number): number {
  const s = ROUND_SETUP_SECONDS[mode] ?? ROUND_SETUP_SECONDS.Unknown;
  return index <= 0 ? s.first : s.later;
}

/** Total setup lock across `rounds` rounds (fractional counts allowed for estimates), in minutes. */
export function setupMinutes(mode: MapMode, rounds: number): number {
  if (!(rounds > 0)) return 0;
  const s = ROUND_SETUP_SECONDS[mode] ?? ROUND_SETUP_SECONDS.Unknown;
  return (s.first + Math.max(0, rounds - 1) * s.later) / 60;
}

/**
 * The fightable window of every round: the round minus its setup lock. Rounds
 * shorter than their lock (a forfeit, a bad capture) contribute nothing rather
 * than a negative span. This is what the aggregator sums into `playedMinutes`
 * and clips hero segments against.
 */
export function playWindowsOf(rounds: ReadonlyArray<RoundSpan>, mode: MapMode): RoundSpan[] {
  const out: RoundSpan[] = [];
  rounds.forEach((r, i) => {
    const startedAt = r.startedAt + roundSetupSeconds(mode, i) * 1000;
    if (r.endedAt > startedAt) out.push({ startedAt, endedAt: r.endedAt });
  });
  return out;
}

/**
 * Minutes of `[segStart, segEnd]` that fall inside any of `windows`. A window
 * with no `endedAt` yet (the round is still running when a hero swaps) extends
 * to `segEnd`.
 */
export function overlapMinutes(
  segStart: number,
  segEnd: number,
  windows: ReadonlyArray<{ startedAt: number; endedAt?: number }>,
): number {
  if (!(segEnd > segStart)) return 0;
  let ms = 0;
  for (const w of windows) {
    const start = Math.max(segStart, w.startedAt);
    const end = Math.min(segEnd, w.endedAt ?? segEnd);
    if (end > start) ms += end - start;
  }
  return ms / 60000;
}

/** Sum of the windows' lengths, in minutes. */
export function windowMinutes(windows: ReadonlyArray<RoundSpan>): number {
  return windows.reduce((m, w) => m + Math.max(0, w.endedAt - w.startedAt), 0) / 60000;
}

/** "2–1" / "2-0" → 3 / 2 (rounds); undefined when the score doesn't read as a round tally. */
function roundsFromScore(finalScore: string | undefined): number | undefined {
  const m = /^\s*(\d+)\s*[–\-:]\s*(\d+)\s*$/.exec(finalScore ?? '');
  if (!m) return undefined;
  return Number(m[1]) + Number(m[2]);
}

/**
 * How many rounds a game had, for the setup-lock subtraction: the recorded
 * rounds when present; on Control a "2–1"-style score (only that mode's score
 * IS a round tally); otherwise the mode's typical competitive count.
 */
export function roundCountOf(game: Pick<GameRecord, 'rounds' | 'finalScore'>, mode: MapMode): number {
  if (game.rounds && game.rounds.length > 0) return game.rounds.length;
  if (mode === 'Control') {
    const fromScore = roundsFromScore(game.finalScore);
    if (fromScore !== undefined && fromScore >= 2 && fromScore <= 3) return fromScore;
  }
  return DEFAULT_ROUNDS[mode] ?? DEFAULT_ROUNDS.Unknown;
}

export interface PlayedTime {
  /** The per-10 divisor: minutes the player could fight. */
  minutes: number;
  /**
   * What the hero minutes on the record are measured against: the recorded
   * played minutes (measured), the wall clock (estimated), or the typed
   * duration (reported). Hero minutes scale by `minutes / baseMinutes`.
   */
  baseMinutes: number;
  source: 'measured' | 'estimated' | 'reported';
}

type PlayedGame = Pick<GameRecord, 'matchId' | 'source' | 'map' | 'durationMinutes' | 'playedMinutes' | 'rounds' | 'perHero' | 'finalScore'>;

/** Minutes the recorded hero segments cover, when every merged row carries them. */
function sumHeroMinutes(perHero: HeroStat[] | undefined): number | undefined {
  if (!perHero?.length) return undefined;
  const merged = mergeHeroStats(perHero);
  if (!merged.every((h) => typeof h.minutes === 'number' && h.minutes > 0)) return undefined;
  return merged.reduce((m, h) => m + (h.minutes ?? 0), 0);
}

/**
 * Resolve a game's played time (see the module doc for the three paths).
 * `null` when nothing usable is recorded — callers then show a dash rather
 * than a rate.
 */
export function playedTimeOf(game: PlayedGame, mapModeOf: MapModeResolver = staticMapMode): PlayedTime | null {
  if (typeof game.playedMinutes === 'number' && game.playedMinutes > 0) {
    return { minutes: game.playedMinutes, baseMinutes: game.playedMinutes, source: 'measured' };
  }
  const wall = typeof game.durationMinutes === 'number' && game.durationMinutes > 0 ? game.durationMinutes : undefined;
  if (sourceOf(game) !== 'gep') {
    return wall !== undefined ? { minutes: wall, baseMinutes: wall, source: 'reported' } : null;
  }
  if (wall === undefined) {
    // A capture with no wall clock at all: Vantage started mid-match, so
    // `match_start` never arrived and no duration was written. What the hero
    // segments cover is only the part that WAS watched — the hero select and
    // the scoreboard already fall outside it, so subtracting them again would
    // deduct time the record never contained.
    const seen = sumHeroMinutes(game.perHero);
    return seen !== undefined ? { minutes: seen, baseMinutes: seen, source: 'estimated' } : null;
  }
  // The wall clock, not the hero-minute sum: a dropped spawn-only first segment
  // (anchored at match start) already excludes the hero select, and subtracting
  // it again would double-count. The sub-minute precision is not worth that.
  const base = wall;
  const mode = mapModeOf(game.map);
  const outside = (PLAYED_TIME_ESTIMATE.preRoundSeconds + PLAYED_TIME_ESTIMATE.postMatchSeconds) / 60;
  const locked = setupMinutes(mode, roundCountOf(game, mode));
  const floor = Math.max(PLAYED_TIME_ESTIMATE.minPlayedMinutes, base * PLAYED_TIME_ESTIMATE.minPlayedFraction);
  return { minutes: Math.max(floor, base - outside - locked), baseMinutes: base, source: 'estimated' };
}

/** Convenience: just the divisor, or `null`. */
export function playedMinutesOf(game: PlayedGame, mapModeOf?: MapModeResolver): number | null {
  return playedTimeOf(game, mapModeOf)?.minutes ?? null;
}

/**
 * The played minutes behind a hero's {@link HeroCredit.share} of a game. Sharing
 * out the played total is what keeps the per-hero minutes summing to it: a hero
 * credited none of the game (a swap clipped to zero played time) gets no minutes
 * either, and a legacy record's wall-clock hero minutes land on the played basis
 * without a second rescale. `null` when the game has no usable time at all.
 */
export function heroPlayedMinutes(share: number, played: PlayedTime | null): number | null {
  return played ? played.minutes * share : null;
}

/**
 * Each hero's share of the player's time in one game, summing to 1 — the
 * fraction of a game (and of its win or loss) that hero earns, the way the
 * career profile credits partial games. Real minutes when every row has them,
 * else an equal split. Keyed by hero name; empty for a game with no heroes.
 */
/** What {@link heroCredits} reads off a game. */
export type HeroCreditGame = Pick<GameRecord, 'heroes' | 'perHero' | 'role' | 'factsEditedAt'>;

export function heroTimeShares(game: HeroCreditGame): Map<string, number> {
  const shares = new Map<string, number>();
  for (const c of heroCredits(game)) shares.set(c.hero, c.share);
  return shares;
}

/** One hero's slice of a game: its stat row, and its share of the game and of the played time. */
export interface HeroCredit {
  hero: string;
  stats: HeroStat;
  /** Share of the game (and of its win or loss). The shares of a game sum to 1. */
  share: number;
}

/**
 * Split a game between the heroes played, by time on each — the career-profile
 * rule. Stats and credit come out of ONE hero set, so no consumer can attribute
 * the two differently.
 *
 * The recorded segments describe the match only while the player has not
 * overruled them. The match editor patches a hand-corrected match's `heroes`,
 * stamps `factsEditedAt` and leaves `perHero` as the feed reported it — so when
 * an EDITED record's two hero lists disagree, the feed's labels were wrong, and
 * with them the split that was keyed to those labels. The match's totals are
 * still the player's, so they are pooled and shared evenly over the heroes the
 * player chose. Absent that explicit correction the recorded rows are trusted,
 * even if they name more heroes than `heroes` does.
 */
export function heroCredits(game: HeroCreditGame): HeroCredit[] {
  const merged = game.perHero?.length ? mergeHeroStats(game.perHero) : [];
  const overruled = game.factsEditedAt != null && game.heroes.length > 0 && !sameHeroSet(merged, game.heroes);
  const trustRows = merged.length > 0 && !overruled;
  const rows = trustRows ? merged : evenlySplit(sumStats(merged), game.heroes, game.role);
  if (!rows.length) return [];
  // Time-weighted as soon as ANYTHING was timed: a segment clipped to zero
  // played minutes (a swap that lived entirely inside a setup phase) earns no
  // credit, instead of dropping the whole match onto an equal split.
  const total = rows.reduce((m, r) => m + (r.minutes ?? 0), 0);
  return rows.map((stats) => ({
    hero: stats.hero,
    stats,
    share: total > 0 ? (stats.minutes ?? 0) / total : 1 / rows.length,
  }));
}

/** Whether the merged rows name exactly the heroes the record lists. */
function sameHeroSet(rows: ReadonlyArray<{ hero: string }>, heroes: ReadonlyArray<string>): boolean {
  const listed = new Set(heroes);
  return listed.size === new Set(rows.map((r) => r.hero)).size && rows.every((r) => listed.has(r.hero));
}

const ZERO = { eliminations: 0, deaths: 0, assists: 0, damage: 0, healing: 0, mitigation: 0 };

/** The match's own totals, however the feed split them between heroes. */
function sumStats(rows: ReadonlyArray<HeroStat>): HeroStat & { minutes?: number } {
  return rows.reduce<HeroStat>(
    (a, r) => ({
      hero: a.hero,
      eliminations: a.eliminations + r.eliminations,
      deaths: a.deaths + r.deaths,
      assists: a.assists + r.assists,
      damage: a.damage + r.damage,
      healing: a.healing + r.healing,
      mitigation: a.mitigation + r.mitigation,
    }),
    { hero: '', ...ZERO },
  );
}

/** `heroes` each carrying an equal slice of `total` (and no timing to go on). */
function evenlySplit(total: HeroStat, heroes: ReadonlyArray<string>, role: GameRecord['role']): HeroStat[] {
  const n = heroes.length;
  if (!n) return [];
  return heroes.map((hero) => ({
    hero,
    role,
    eliminations: total.eliminations / n,
    deaths: total.deaths / n,
    assists: total.assists / n,
    damage: total.damage / n,
    healing: total.healing / n,
    mitigation: total.mitigation / n,
  }));
}
