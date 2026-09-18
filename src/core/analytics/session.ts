/**
 * Session-level reads over the game list: the current streak, the current
 * (gap-based) sitting's recap, the activity calendar, and the per-hero
 * drill-down. Pure and I/O-free — consumed by both main and the browser
 * preview.
 */
import type { GameRecord, Streak } from './types';
import { byHero, byMap, dayKey, heroWeightedGames, weightedGroupBy, weightedWinLoss, winLoss } from './grouping';
import { heroStats, type HeroStatsOptions } from './heroStats';
import { focusTrend, heroForm } from './focus';
import { activeMeasuredTargets, foldMeasuredGradesForExport, NOTION_IMPROVEMENT_TARGET_ID, type AuthoredTarget } from '../targets';
import { isPositiveComms } from '../comms';
import { isCompetitive } from '../matchFilter';

/** Current win/loss streak from the most recent decided games. */
export function streak(games: GameRecord[]): Streak {
  const decided = [...games].filter((g) => g.result !== 'Draw').sort((a, b) => b.timestamp - a.timestamp);
  if (!decided.length) return { type: 'none', count: 0 };
  const type = decided[0].result === 'Win' ? 'W' : 'L';
  let count = 0;
  for (const g of decided) {
    if ((g.result === 'Win' ? 'W' : 'L') === type) count++;
    else break;
  }
  return { type, count };
}

/** Longest win/loss runs plus the best/worst single calendar day (net wins − losses) in range (C7). */
export interface StreakStats {
  longestWin: number;
  longestLoss: number;
  bestDay?: { date: string; net: number; wins: number; losses: number };
  worstDay?: { date: string; net: number; wins: number; losses: number };
}

/**
 * The extremes {@link streak} (current run only) doesn't answer: the longest
 * win/loss run anywhere in range, and the single best/worst calendar day by
 * net wins − losses. `bestDay`/`worstDay.date` is a `dayKey`, ready for
 * Matches' `{ day }` drill-down. Undefined when there are no games at all.
 */
export function streakStats(games: GameRecord[]): StreakStats {
  const decided = [...games].filter((g) => g.result !== 'Draw').sort((a, b) => a.timestamp - b.timestamp);
  let longestWin = 0;
  let longestLoss = 0;
  let curType: 'W' | 'L' | null = null;
  let curCount = 0;
  for (const g of decided) {
    const type = g.result === 'Win' ? 'W' : 'L';
    curCount = type === curType ? curCount + 1 : 1;
    curType = type;
    if (type === 'W') longestWin = Math.max(longestWin, curCount);
    else longestLoss = Math.max(longestLoss, curCount);
  }

  const days = groupByDay(games).map((d) => ({ date: d.key, net: d.wins - d.losses, wins: d.wins, losses: d.losses }));
  // Ties keep whichever was found first — groupByDay is newest-first, so a
  // tie resolves to the more recent day.
  const bestDay = days.length ? days.reduce((a, b) => (b.net > a.net ? b : a)) : undefined;
  const worstDay = days.length ? days.reduce((a, b) => (b.net < a.net ? b : a)) : undefined;

  return { longestWin, longestLoss, bestDay, worstDay };
}

/**
 * Recap of the current sitting: the trailing run of games with no gap longer
 * than `gapMinutes` between consecutive games, ending at the most recent one.
 * Null when there are no games, or when the most recent game is itself older
 * than `gapMinutes` ago (the sitting has since closed).
 */
export function currentSession(
  games: GameRecord[],
  now: number = Date.now(),
  gapMinutes: number = 180,
) {
  if (!games.length) return null;
  const sorted = [...games].sort((a, b) => a.timestamp - b.timestamp);
  const gapMs = gapMinutes * 60_000;
  let trailing: GameRecord[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].timestamp - sorted[i - 1].timestamp > gapMs) trailing = [];
    trailing.push(sorted[i]);
  }
  const last = trailing[trailing.length - 1];
  if (now - last.timestamp > gapMs) return null; // the trailing sitting has since closed
  return { date: dayKey(last.timestamp), ...winLoss(trailing), streak: streak(trailing), topMaps: byMap(trailing).slice(0, 3) };
}

/** Per-day games + winrate for the last `days` calendar days (heatmap). */
export function calendar(games: GameRecord[], days = 35): Array<{ date: string; games: number; winrate: number | null }> {
  const map = new Map<string, GameRecord[]>();
  for (const g of games) {
    const k = dayKey(g.timestamp);
    (map.get(k) ?? map.set(k, []).get(k)!).push(g);
  }
  const out: Array<{ date: string; games: number; winrate: number | null }> = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const k = dayKey(d.getTime());
    const gs = map.get(k) ?? [];
    out.push({ date: k, games: gs.length, winrate: gs.length ? winLoss(gs).winrate : null });
  }
  return out;
}

/** One day header + its games (the Matches screen's grouped list). */
export interface DayGroup<T> {
  /** dayKey of the group, newest group first. */
  key: string;
  /** 'Today' / 'Yesterday' for the two most recent days, else the raw key. */
  label: string;
  wins: number;
  losses: number;
  draws: number;
  /** Sum of the group's known SR deltas; absent when no row in the group logged one — never a fabricated 0 (M3). */
  srNet?: number;
  /** How many of the group's rows contributed to {@link srNet}. */
  srKnown: number;
  items: T[];
}

/** The W/L/D + SR tally shared by {@link groupByDay} and {@link groupBySitting}'s groups. */
function dayTally<T extends { result: string; srDelta?: number }>(
  items: T[],
): Pick<DayGroup<T>, 'wins' | 'losses' | 'draws' | 'srNet' | 'srKnown'> {
  const deltas = items.map((r) => r.srDelta).filter((v): v is number => v != null);
  return {
    wins: items.filter((r) => r.result === 'Win').length,
    losses: items.filter((r) => r.result === 'Loss').length,
    draws: items.filter((r) => r.result === 'Draw').length,
    srKnown: deltas.length,
    ...(deltas.length ? { srNet: deltas.reduce((a, b) => a + b, 0) } : {}),
  };
}

/** Group timestamped result rows under day headers (newest day first). */
export function groupByDay<T extends { timestamp: number; result: string; srDelta?: number }>(
  rows: T[],
  now: number = Date.now(),
): Array<DayGroup<T>> {
  const groups = new Map<string, T[]>();
  for (const r of [...rows].sort((a, b) => b.timestamp - a.timestamp)) {
    const k = dayKey(r.timestamp);
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
  }
  const today = dayKey(now);
  const yesterday = dayKey(now - 86_400_000);
  return [...groups.entries()].map(([key, items]) => ({
    key,
    label: key === today ? 'Today' : key === yesterday ? 'Yesterday' : key,
    ...dayTally(items),
    items,
  }));
}

/**
 * The "how did that go?" read for the trailing gap-based sitting (S3) — the
 * Overview recap used to key off the previous UTC calendar day, so a sitting
 * spanning midnight was split across two days and a player west of UTC had
 * evening games filed under the next day. This follows the same sitting
 * boundary {@link currentSession} walks instead, so it stays one block.
 */
export interface SessionDebrief {
  startedAt: number;
  endedAt: number;
  /** True once the sitting has closed (the newest game is older than the gap) — the caller decides whether to show a debrief for a still-open sitting. */
  closed: boolean;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  winrate: number;
  net: number;
  /** Sum of logged SR deltas; absent when the sitting logged none. */
  srDelta?: number;
  /** How many of `games` contributed to {@link srDelta}. */
  srDeltaGames?: number;
  bestMap?: string;
  worstMap?: string;
  /** Heroes played, by time-share credited games, most-played first (top 3). */
  heroes: Array<{ hero: string; winrate: number; games: number }>;
  flags: { tilt: number; toxicMates: number; leaver: number; positiveComms: number };
  /** Hit-rate over the sitting's graded targets — self-rated grades PLUS active measured auto-grades; absent when nothing was graded. */
  targetHitRate?: number;
  /** Competitive games in the sitting with no review at all yet — "Review these N games →". */
  ungradedMatchIds: string[];
}

/**
 * Debrief of the trailing gap-based sitting — the same boundary
 * {@link currentSession} walks, over the FULL unfiltered history (a player
 * who last played two days ago still gets a debrief for THAT sitting, not
 * nothing). Null when there are no games at all.
 */
export function sessionDebrief(
  games: GameRecord[],
  targets: readonly AuthoredTarget[],
  now: number = Date.now(),
  gapMinutes: number = 180,
  margin?: number,
): SessionDebrief | null {
  if (!games.length) return null;
  const sorted = [...games].sort((a, b) => a.timestamp - b.timestamp);
  const gapMs = gapMinutes * 60_000;
  let trailing: GameRecord[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].timestamp - sorted[i - 1].timestamp > gapMs) trailing = [];
    trailing.push(sorted[i]);
  }
  const last = trailing[trailing.length - 1];

  const wl = winLoss(trailing);
  const maps = byMap(trailing).filter((m) => m.games > 0);
  const byWr = [...maps].sort((a, b) => b.winrate - a.winrate);
  const heroes = byHero(trailing)
    .filter((h) => h.key !== 'Unknown')
    .sort((a, b) => b.games - a.games)
    .slice(0, 3)
    .map((h) => ({ hero: h.key, winrate: h.winrate, games: h.games }));

  const flags = { tilt: 0, toxicMates: 0, leaver: 0, positiveComms: 0 };
  for (const g of trailing) {
    for (const key of Object.keys(flags) as Array<keyof typeof flags>) {
      if (key === 'positiveComms') {
        if (isPositiveComms(g.mental) || isPositiveComms(g.review?.flags)) flags.positiveComms++;
      } else if (g.mental?.[key] || g.review?.flags?.[key]) {
        flags[key]++;
      }
    }
  }

  const srDeltas = trailing.map((g) => g.srDelta).filter((v): v is number => v != null);

  // Hit-rate over the merged grade view every self+measured surface already
  // uses (foldMeasuredGradesForExport): stored self-rated grades, with every
  // currently-active MEASURED target's grade recomputed fresh from stats
  // (dropped when the match can't measure it) — so a stale stored grade or a
  // target that's since gone inactive can't leak into tonight's read.
  const activeMeasured = activeMeasuredTargets(targets);
  let hits = 0;
  let attempts = 0;
  for (const g of trailing) {
    const effective = foldMeasuredGradesForExport(g.review?.grades, activeMeasured, g, margin);
    for (const [targetId, grade] of Object.entries(effective)) {
      if (targetId === NOTION_IMPROVEMENT_TARGET_ID) continue;
      attempts++;
      if (grade === 'hit') hits++;
    }
  }

  return {
    startedAt: trailing[0].timestamp,
    endedAt: last.timestamp,
    closed: now - last.timestamp > gapMs,
    games: trailing.length,
    wins: wl.wins,
    losses: wl.losses,
    draws: wl.draws,
    winrate: wl.winrate,
    net: wl.wins - wl.losses,
    ...(srDeltas.length ? { srDelta: srDeltas.reduce((a, b) => a + b, 0), srDeltaGames: srDeltas.length } : {}),
    ...(byWr.length >= 2 ? { bestMap: byWr[0].key, worstMap: byWr[byWr.length - 1].key } : {}),
    heroes,
    flags,
    ...(attempts ? { targetHitRate: hits / attempts } : {}),
    ungradedMatchIds: trailing.filter((g) => !g.review && isCompetitive(g.gameType)).map((g) => g.matchId),
  };
}

/** A game with no logged duration is assumed this long — mirrors readiness's own `defaultGameMinutes` fallback, duplicated rather than imported so this stays independent of readiness's internal tuning (S4). */
const DEFAULT_GAME_MINUTES = 12;

/** One past sitting, newest first (S4) — the compact row `sessionHistory` returns per sitting, for a history list rather than a single debrief. */
export interface SessionSummary {
  startedAt: number;
  endedAt: number;
  /** Wall-clock span of the sitting, including the first game's own play time (its `timestamp` marks when it ENDED). */
  minutes: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  winrate: number;
  net: number;
  /** Sum of logged, non-suppressed SR deltas; absent when the sitting logged none. */
  srDelta?: number;
  /** How many of `games` contributed to {@link srDelta}. */
  srDeltaGames?: number;
  /** Games flagged tilted (quick-log OR review, merged so one game never double-counts). */
  tiltCount: number;
  /** The streak AT THE END of the sitting. */
  streak: Streak;
  /** Most-played map in the sitting, when any game recorded one. */
  topMap?: string;
  /** Average self-rating (0-100) over the sitting's rated games; absent when none were rated. */
  avgRating?: number;
}

/**
 * Every past sitting, newest first (S4) — the gap-walk `currentSession`/
 * `sessionDebrief` already use, applied across the WHOLE history instead of
 * just the trailing sitting. `suppressed` (placement-run games) is excluded
 * from the SR sum only — a placement's SR swings are not comparable to a
 * normal match's, but the games themselves still count toward W-L/tilt/etc.
 */
export function sessionHistory(
  games: GameRecord[],
  gapMinutes: number = 180,
  suppressed?: ReadonlySet<string>,
): SessionSummary[] {
  if (!games.length) return [];
  const sorted = [...games].sort((a, b) => a.timestamp - b.timestamp);
  const gapMs = gapMinutes * 60_000;
  const sittings: GameRecord[][] = [];
  let current: GameRecord[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].timestamp - sorted[i - 1].timestamp > gapMs) {
      sittings.push(current);
      current = [];
    }
    current.push(sorted[i]);
  }
  sittings.push(current);

  return sittings.reverse().map((sitting): SessionSummary => {
    const first = sitting[0];
    const last = sitting[sitting.length - 1];
    const wl = winLoss(sitting);
    const maps = byMap(sitting).filter((m) => m.games > 0).sort((a, b) => b.games - a.games);

    let tiltCount = 0;
    for (const g of sitting) {
      if (g.mental?.tilt || g.review?.flags?.tilt) tiltCount++;
    }

    const srDeltas = sitting
      .filter((g) => !suppressed?.has(g.matchId))
      .map((g) => g.srDelta)
      .filter((v): v is number => v != null);
    const ratings = sitting.map((g) => g.performance).filter((v): v is number => v != null);

    return {
      startedAt: first.timestamp,
      endedAt: last.timestamp,
      minutes: Math.round((last.timestamp - first.timestamp) / 60_000 + (first.durationMinutes ?? DEFAULT_GAME_MINUTES)),
      games: sitting.length,
      wins: wl.wins,
      losses: wl.losses,
      draws: wl.draws,
      winrate: wl.winrate,
      net: wl.wins - wl.losses,
      ...(srDeltas.length ? { srDelta: srDeltas.reduce((a, b) => a + b, 0), srDeltaGames: srDeltas.length } : {}),
      tiltCount,
      streak: streak(sitting),
      ...(maps[0] ? { topMap: maps[0].key } : {}),
      ...(ratings.length ? { avgRating: ratings.reduce((a, b) => a + b, 0) / ratings.length } : {}),
    };
  });
}

/**
 * Group timestamped rows by their gap-based SITTING rather than calendar day
 * (S4) — a past-midnight sitting stays one block instead of splitting under
 * "Today"/"Yesterday" with two separate tallies. Same label convention as
 * {@link groupByDay}: the sitting containing `now` reads "Today's session" (only
 * meaningful if it's still open — callers scope `rows` accordingly), newest first.
 */
export function groupBySitting<T extends { timestamp: number; result: string; srDelta?: number }>(
  rows: T[],
  gapMinutes: number,
  now: number = Date.now(),
): Array<DayGroup<T>> {
  const sorted = [...rows].sort((a, b) => b.timestamp - a.timestamp); // newest first
  const gapMs = gapMinutes * 60_000;
  const groups: Array<{ items: T[] }> = [];
  for (const r of sorted) {
    const open = groups[groups.length - 1];
    if (open && open.items[open.items.length - 1].timestamp - r.timestamp <= gapMs) open.items.push(r);
    else groups.push({ items: [r] });
  }
  const todayOpen = groups[0] && now - groups[0].items[0].timestamp <= gapMs;
  return groups.map((g, i) => {
    const start = g.items[g.items.length - 1].timestamp;
    const end = g.items[0].timestamp;
    const label = i === 0 && todayOpen
      ? 'Today’s session'
      : `${new Date(start).toLocaleDateString(undefined, { weekday: 'short' })} · ${new Date(start).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}–${new Date(end).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
    return {
      key: `${start}`,
      label,
      ...dayTally(g.items),
      items: g.items,
    };
  });
}

/**
 * Drill-down for one hero: overall, per-map, recent games, exact stats.
 * `overall` and `byMap` credit each game by the hero's share of the player's
 * time in it (the career-profile rule, matching the Heroes table); `recent`
 * lists the games whole.
 */
export function heroDetail(games: GameRecord[], hero: string, opts: HeroStatsOptions = {}) {
  const gs = games.filter((g) => g.heroes.includes(hero)).sort((a, b) => b.timestamp - a.timestamp);
  const weighted = heroWeightedGames(gs, hero);
  const stats = heroStats(gs, opts).find((h) => h.hero === hero) ?? null;
  // Trend/form (H6) reuse the same hero-filtered `gs` dashboardData's Heroes
  // table join computes over — `gs` here already IS `focusGamesFor(games, 'hero', hero)`.
  const trend = focusTrend(gs);
  return {
    hero,
    overall: weightedWinLoss(weighted),
    byMap: weightedGroupBy(weighted, (e) => e.game.map).slice(0, 12),
    recent: gs.slice(0, 10).map((g) => ({ matchId: g.matchId, map: g.map, role: g.role, result: g.result, account: g.account, timestamp: g.timestamp })),
    stats: stats ? { ...stats, ...(trend ? { trend } : {}), form: heroForm(gs) } : null,
  };
}
