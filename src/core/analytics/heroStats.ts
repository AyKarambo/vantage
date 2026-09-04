/**
 * Per-hero stat rollups for the local player: exact totals, winrates and
 * per-10-minute averages aggregated across games.
 * Pure and I/O-free — consumed by both main and the browser preview.
 *
 * Two rules keep these numbers comparable with the game's own career profile:
 *
 *  - PER-10 DIVIDES BY PLAYED TIME. Rates are `total × 10 / minutes played on
 *    the hero`, where played time excludes hero select, the per-mode setup
 *    locks and the post-match scoreboard (see {@link ../playedTime}). Newer
 *    captures carry it measured from the GEP rounds; older captures and manual
 *    logs are estimated / taken as typed by `playedTimeOf`, and a hero row's
 *    minutes are rescaled onto that basis by `heroPlayedMinutes`.
 *
 *  - GAMES AND WINS ARE CREDITED BY TIME SHARE. Blizzard's career profile shows
 *    fractional "Games Played" / "Games Won" per hero: each hero played in a
 *    match earns the fraction of that game (and of its win or loss) equal to
 *    its share of the player's time in it, with no minimum-time threshold —
 *    Tracer 6 min + Genji 2 min in one won game is 0.75 + 0.25 of a win. Win %
 *    is computed from the fractional credit; the displayed counts are the
 *    rounded credit (`heroTimeShares`). Without hero minutes the share is an
 *    equal split.
 */
import type { GameRecord, HeroSummary, HeroStat } from './types';
import { heroCredits, heroPlayedMinutes, playedTimeOf, type MapModeResolver } from '../playedTime';
import { roundCredit } from './grouping';

export interface HeroStatsOptions {
  /** Map name → mode for the played-time estimate on captures without rounds (defaults to the built-in table). */
  mapModeOf?: MapModeResolver;
}

/** Exact per-hero stats for the local player, aggregated across games. */
export function heroStats(games: GameRecord[], opts: HeroStatsOptions = {}): HeroSummary[] {
  const totals = new Map<string, HeroStat & { games: number; wins: number; losses: number; draws: number; minutes: number }>();

  for (const g of games) {
    const played = playedTimeOf(g, opts.mapModeOf);
    // Stats, game credit and minutes all come out of the same split, so a hero
    // can never collect one without the others (same-hero swap segments are
    // merged inside, so a hero used twice counts once).
    for (const { hero, stats: r, share } of heroCredits(g)) {
      const t = totals.get(hero) ?? {
        hero, role: r.role, eliminations: 0, deaths: 0, assists: 0,
        damage: 0, healing: 0, mitigation: 0, games: 0, wins: 0, losses: 0, draws: 0, minutes: 0,
      };
      t.role = t.role ?? r.role;
      t.eliminations += r.eliminations;
      t.deaths += r.deaths;
      t.assists += r.assists;
      t.damage += r.damage;
      t.healing += r.healing;
      t.mitigation += r.mitigation;
      t.games += share;
      if (g.result === 'Win') t.wins += share;
      else if (g.result === 'Loss') t.losses += share;
      else t.draws += share;
      t.minutes += heroPlayedMinutes(share, played) ?? 0;
      totals.set(hero, t);
    }
  }

  return [...totals.values()]
    .map((t) => {
      const decided = t.wins + t.losses;
      const per10 = t.minutes > 0 ? scale(t, 10 / t.minutes) : null;
      return {
        hero: t.hero,
        role: t.role,
        // Rounded together so the parts add up (see roundCredit).
        ...roundCredit({ games: t.games, wins: t.wins, losses: t.losses, draws: t.draws }),
        winrate: decided ? t.wins / decided : 0,
        creditedGames: t.games,
        creditedWins: t.wins,
        creditedLosses: t.losses,
        totals: {
          eliminations: t.eliminations, deaths: t.deaths, assists: t.assists,
          damage: t.damage, healing: t.healing, mitigation: t.mitigation,
        },
        per10,
        kda: (t.eliminations + t.assists) / Math.max(t.deaths, 1),
      } as HeroSummary;
    })
    // Most-played first by the unrounded credit, so two heroes that round to
    // the same count still order by real time on hero.
    .sort((a, b) => (b.creditedGames ?? b.games) - (a.creditedGames ?? a.games));
}

// --- helpers ----------------------------------------------------------------

function scale(t: HeroStat, f: number) {
  return {
    eliminations: round1(t.eliminations * f),
    deaths: round1(t.deaths * f),
    assists: round1(t.assists * f),
    damage: Math.round(t.damage * f),
    healing: Math.round(t.healing * f),
    mitigation: Math.round(t.mitigation * f),
  };
}
const round1 = (n: number) => Math.round(n * 10) / 10;
