/**
 * Per-hero stat rollups for the local player: exact totals, winrates and
 * per-10-minute averages aggregated across games.
 * Pure and I/O-free — consumed by both main and the browser preview.
 */
import type { GameRecord, HeroSummary, HeroStat } from './types';

/** Exact per-hero stats for the local player, aggregated across games. */
export function heroStats(games: GameRecord[]): HeroSummary[] {
  const totals = new Map<string, HeroStat & { games: number; wins: number; losses: number; minutes: number }>();

  for (const g of games) {
    const decidedWin = g.result === 'Win' ? 1 : 0;
    const decidedLoss = g.result === 'Loss' ? 1 : 0;
    const minutes = g.durationMinutes ?? 0;
    const rows: HeroStat[] = g.perHero?.length
      ? g.perHero
      : g.heroes.map((hero) => ({ hero, role: g.role, eliminations: 0, deaths: 0, assists: 0, damage: 0, healing: 0, mitigation: 0 }));

    const sharedMinutes = rows.length ? minutes / rows.length : 0;
    for (const r of rows) {
      const t = totals.get(r.hero) ?? {
        hero: r.hero, role: r.role, eliminations: 0, deaths: 0, assists: 0,
        damage: 0, healing: 0, mitigation: 0, games: 0, wins: 0, losses: 0, minutes: 0,
      };
      t.role = t.role ?? r.role;
      t.eliminations += r.eliminations;
      t.deaths += r.deaths;
      t.assists += r.assists;
      t.damage += r.damage;
      t.healing += r.healing;
      t.mitigation += r.mitigation;
      t.games += 1;
      t.wins += decidedWin;
      t.losses += decidedLoss;
      t.minutes += sharedMinutes;
      totals.set(r.hero, t);
    }
  }

  return [...totals.values()]
    .map((t) => {
      const decided = t.wins + t.losses;
      const per10 = t.minutes > 0 ? scale(t, 10 / t.minutes) : null;
      return {
        hero: t.hero,
        role: t.role,
        games: t.games,
        wins: t.wins,
        losses: t.losses,
        draws: t.games - decided,
        winrate: decided ? t.wins / decided : 0,
        totals: {
          eliminations: t.eliminations, deaths: t.deaths, assists: t.assists,
          damage: t.damage, healing: t.healing, mitigation: t.mitigation,
        },
        per10,
        kda: (t.eliminations + t.assists) / Math.max(t.deaths, 1),
      } as HeroSummary;
    })
    .sort((a, b) => b.games - a.games);
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
