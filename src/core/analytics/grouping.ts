/**
 * Win/loss aggregation and grouping: slices completed games by map, role,
 * account, hero, mode or time bucket — the building blocks of every dashboard
 * chart. Pure and I/O-free — consumed by both main and the browser preview.
 */
import type { GameRecord, WinLoss, Group, FocusItem, TrendGroup, Momentum } from './types';
import { heroTimeShares } from '../playedTime';

// --- core aggregation -------------------------------------------------------

/** Tally wins/losses/draws and the winrate (0..1, draws excluded) over a set of games. */
export function winLoss(games: GameRecord[]): WinLoss {
  let wins = 0;
  let losses = 0;
  let draws = 0;
  for (const g of games) {
    if (g.result === 'Win') wins++;
    else if (g.result === 'Loss') losses++;
    else draws++;
  }
  const decided = wins + losses;
  return { games: games.length, wins, losses, draws, winrate: decided ? wins / decided : 0 };
}

/** A game with the fraction of it (0..1) that a bucket is credited with. */
export interface WeightedGame {
  game: GameRecord;
  weight: number;
}

/**
 * {@link winLoss} with fractional credit: each game counts `weight` toward the
 * tally (a hero played for a quarter of a game earns 0.25 of it and of its win
 * or loss — the career-profile rule). `winrate` is computed from the unrounded
 * credit; `games`/`wins`/`losses`/`draws` are rounded for display.
 */
export function weightedWinLoss(entries: ReadonlyArray<WeightedGame>): WinLoss {
  let games = 0;
  let wins = 0;
  let losses = 0;
  let draws = 0;
  for (const { game, weight } of entries) {
    games += weight;
    if (game.result === 'Win') wins += weight;
    else if (game.result === 'Loss') losses += weight;
    else draws += weight;
  }
  const decided = wins + losses;
  return { ...roundCredit({ games, wins, losses, draws }), winrate: decided ? wins / decided : 0 };
}

/**
 * Round fractional credit for display so the parts still add up. `games` rounds
 * normally; wins/losses/draws are then allocated by largest remainder to sum to
 * exactly that. Rounding each on its own let two 0.5 credits both round to 1
 * and show a hero more wins + losses than games played.
 */
export function roundCredit(c: {
  games: number; wins: number; losses: number; draws: number;
}): Pick<WinLoss, 'games' | 'wins' | 'losses' | 'draws'> {
  // Any credit at all is at least one game: rounding a 0.4-game hero to 0 while
  // its winrate still read 100% put "0 games · 100%" on the drill-down.
  const games = c.games > 0 ? Math.max(1, Math.round(c.games)) : 0;
  const parts = [c.wins, c.losses, c.draws];
  const out = parts.map((v) => Math.floor(v));
  // Hand out (or take back) whole games one at a time, largest fractional part
  // first, so the biggest share rounds up before a smaller one does.
  const byRemainder = parts
    .map((v, i) => ({ i, frac: v - out[i] }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  let left = games - out.reduce((a, b) => a + b, 0);
  for (let n = 0; left > 0 && n < byRemainder.length; n += 1, left -= 1) out[byRemainder[n].i] += 1;
  for (let n = byRemainder.length - 1; left < 0 && n >= 0; n -= 1) {
    if (out[byRemainder[n].i] > 0) { out[byRemainder[n].i] -= 1; left += 1; }
  }
  return { games, wins: out[0], losses: out[1], draws: out[2] };
}

export interface GroupOpts {
  /** Placement-run match ids to exclude from the net-SR sum (C2) — the games themselves still count toward win/loss. */
  suppressed?: ReadonlySet<string>;
}

/**
 * Sum of `srDelta` over games that logged one (C2), excluding `suppressed`
 * (placement-run) games — a placement's SR swing isn't comparable to a normal
 * match's, the same stance {@link ../session sessionHistory} takes. Undefined
 * when nothing qualified, so a bucket with no logged deltas reads "—", not 0.
 * `weight` credits a fractional bucket (a hero's time-share) proportionally,
 * same as every other weighted field; it is 1 for a whole-game bucket.
 */
export function srSum(games: ReadonlyArray<{ game: GameRecord; weight: number }>, suppressed?: ReadonlySet<string>): Pick<Group, 'srNet' | 'srLogged'> {
  const logged = games.filter(({ game }) => !suppressed?.has(game.matchId) && game.srDelta != null);
  if (!logged.length) return {};
  return { srNet: logged.reduce((n, { game, weight }) => n + game.srDelta! * weight, 0), srLogged: logged.length };
}

/** Group weighted games by a key and compute the weighted win/loss per group, most credit first. */
export function weightedGroupBy<T extends WeightedGame>(entries: ReadonlyArray<T>, keyOf: (e: T) => string, opts: GroupOpts = {}): Group[] {
  const buckets = new Map<string, T[]>();
  for (const e of entries) {
    const k = keyOf(e) || 'Unknown';
    (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(e);
  }
  return [...buckets.entries()]
    .map(([key, es]) => ({
      key, credit: es.reduce((n, e) => n + e.weight, 0), wl: weightedWinLoss(es),
      sr: srSum(es, opts.suppressed),
    }))
    // By unrounded credit, so two keys that round to the same count still order by real share.
    .sort((a, b) => b.credit - a.credit)
    .map(({ key, wl, sr }) => ({ key, ...wl, ...sr }));
}

/**
 * Every game paired with `hero`'s share of the player's time in it (see
 * {@link ../playedTime heroTimeShares}); games the hero wasn't played in are
 * left out. The weighting behind {@link byHero} and the hero drill-down.
 */
export function heroWeightedGames(games: GameRecord[], hero: string): WeightedGame[] {
  const out: WeightedGame[] = [];
  for (const game of games) {
    const weight = heroTimeShares(game).get(hero);
    if (weight) out.push({ game, weight });
  }
  return out;
}

/** Group games by a key and compute win/loss per group, sorted by most games. */
export function groupBy(games: GameRecord[], keyOf: (g: GameRecord) => string, opts: GroupOpts = {}): Group[] {
  const buckets = new Map<string, GameRecord[]>();
  for (const g of games) {
    const k = keyOf(g) || 'Unknown';
    (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(g);
  }
  return [...buckets.entries()]
    .map(([key, gs]) => ({ key, ...winLoss(gs), ...srSum(gs.map((game) => ({ game, weight: 1 })), opts.suppressed) }))
    .sort((a, b) => b.games - a.games);
}

/** Winrate per map. */
export const byMap = (g: GameRecord[], opts?: GroupOpts) => groupBy(g, (x) => x.map, opts);
/** Winrate per role queue. */
export const byRole = (g: GameRecord[], opts?: GroupOpts) => groupBy(g, (x) => x.role, opts);
/** Winrate per tracked account. */
export const byAccount = (g: GameRecord[]) => groupBy(g, (x) => x.account);

/**
 * Hero winrate with career-profile credit: every hero the player used in a game
 * earns the fraction of it equal to its share of the player's time (an equal
 * split without hero minutes), so a one-minute swap no longer counts as a
 * whole game. A game with no heroes recorded is credited to `Unknown` whole.
 */
export function byHero(games: GameRecord[], opts: GroupOpts = {}): Group[] {
  const entries: Array<WeightedGame & { hero: string }> = [];
  for (const game of games) {
    const shares = heroTimeShares(game);
    if (!shares.size) entries.push({ game, weight: 1, hero: 'Unknown' });
    for (const [hero, weight] of shares) entries.push({ game, weight, hero });
  }
  return weightedGroupBy(entries, (e) => e.hero, opts);
}

/**
 * "Focus" ranking — where you're losing more than winning. Net = losses − wins;
 * highest net first. This is the dashboard's "what to work on" signal.
 */
export function focusBy(
  games: GameRecord[],
  keyOf: (g: GameRecord) => string,
  minGames = 3,
  opts: GroupOpts = {},
): FocusItem[] {
  return groupBy(games, keyOf, opts)
    .filter((g) => g.games >= minGames)
    .map((g) => ({ ...g, net: g.losses - g.wins }))
    .sort((a, b) => b.net - a.net);
}

/** Winrate trend bucketed by day or ISO week. */
export function trend(games: GameRecord[], bucket: 'day' | 'week' = 'day'): Group[] {
  const sorted = [...games].sort((a, b) => a.timestamp - b.timestamp);
  return groupBy(sorted, (g) => bucketLabel(g.timestamp, bucket)).sort((a, b) =>
    a.key < b.key ? -1 : 1,
  );
}

/** Winrate per game type (Competitive, Quick Play, …). */
export const byMode = (g: GameRecord[]): Group[] => groupBy(g, (x) => x.gameType);

/** UTC calendar-day key (YYYY-MM-DD) — the shared day-bucketing convention. */
export function dayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/**
 * Game-weighted, calendar-true rolling winrate over {@link trend}'s buckets
 * (C6). `trend` is sparse — only days/weeks with games exist — so a naive
 * "average the last N array entries" smoother compresses across a quiet
 * stretch (three-evenings-a-week play made a "7-day" line span ~2.5 calendar
 * weeks) and, unweighted per bucket, lets a 1-game day move it as much as a
 * 12-game day. This instead sums wins/losses over every bucket whose period
 * start falls within the trailing `window` periods (7 calendar days in daily
 * mode, 7 ISO weeks in weekly mode) of the current bucket — a real calendar
 * window, weighted by the games actually behind it.
 */
export function rollingWinrate(buckets: Group[], bucket: 'day' | 'week', window = 7): TrendGroup[] {
  const periodMs = (bucket === 'day' ? 1 : 7) * 86_400_000;
  const starts = buckets.map((b) => bucketStart(b.key, bucket));
  const out: TrendGroup[] = [];
  let lo = 0, wins = 0, losses = 0;
  for (let i = 0; i < buckets.length; i++) {
    wins += buckets[i].wins;
    losses += buckets[i].losses;
    const windowStart = starts[i] - (window - 1) * periodMs;
    while (starts[lo] < windowStart) {
      wins -= buckets[lo].wins;
      losses -= buckets[lo].losses;
      lo++;
    }
    const decided = wins + losses;
    out.push({ ...buckets[i], rolling: decided ? wins / decided : 0 });
  }
  return out;
}

/** Games behind a bucket's own rolling window before it clears the sample floor for {@link windowCompare}. */
const MOMENTUM_MIN_DECIDED = 5;

/**
 * The winrate-chart momentum read (C6): the trailing `days`-long window
 * ending at `now` compared against the `days`-long window before it —
 * decided games only, so a couple of games can't manufacture a swing. Null
 * when either window falls short of the sample floor (the strip then reads
 * "–" rather than a number nobody should trust).
 */
export function windowCompare(games: GameRecord[], now: number, days = 7): Momentum | null {
  const windowMs = days * 86_400_000;
  const between = (start: number, end: number) => games.filter((g) => g.timestamp > start && g.timestamp <= end);
  const recent = winLoss(between(now - windowMs, now));
  const previous = winLoss(between(now - 2 * windowMs, now - windowMs));
  if (recent.wins + recent.losses < MOMENTUM_MIN_DECIDED || previous.wins + previous.losses < MOMENTUM_MIN_DECIDED) {
    return null;
  }
  return { days, recent, previous, deltaPts: Math.round((recent.winrate - previous.winrate) * 100) };
}

// --- helpers ----------------------------------------------------------------

/** The UTC start-of-period timestamp a `trend`/{@link rollingWinrate} bucket key names — the inverse of `bucketLabel`. */
function bucketStart(key: string, bucket: 'day' | 'week'): number {
  if (bucket === 'day') return Date.parse(key);
  const [year, week] = key.split('-W').map(Number);
  const jan4 = Date.UTC(year, 0, 4);
  const jan4Weekday = new Date(jan4).getUTCDay() || 7;
  const week1Monday = jan4 - (jan4Weekday - 1) * 86_400_000;
  return week1Monday + (week - 1) * 7 * 86_400_000;
}

function bucketLabel(ts: number, bucket: 'day' | 'week'): string {
  const d = new Date(ts);
  if (bucket === 'day') return d.toISOString().slice(0, 10);
  // ISO week label YYYY-Www
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
