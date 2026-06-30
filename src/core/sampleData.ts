import type { GameRecord, HeroStat } from './analytics';
import type { Result, Role } from './model';

/**
 * Generates a realistic season of games (deterministic, seeded) so the dashboard
 * has something to show while live GEP is pending approval. The same
 * `GameRecord` shape is produced from GEP at runtime.
 */

const MAPS: Record<string, string> = {
  'New Queen Street': 'Push', Colosseo: 'Push', 'Esperança': 'Push', Runasapi: 'Push',
  "King's Row": 'Hybrid', Midtown: 'Hybrid', Eichenwalde: 'Hybrid', Hollywood: 'Hybrid', Numbani: 'Hybrid', 'Blizzard World': 'Hybrid',
  'Circuit Royal': 'Escort', Dorado: 'Escort', Havana: 'Escort', Junkertown: 'Escort', Rialto: 'Escort', 'Route 66': 'Escort', 'Shambali Monastery': 'Escort',
  'Antarctic Peninsula': 'Control', Busan: 'Control', Ilios: 'Control', 'Lijiang Tower': 'Control', Nepal: 'Control', Oasis: 'Control', Samoa: 'Control',
  'New Junk City': 'Flashpoint', Suravasa: 'Flashpoint',
};

const HEROES: Record<Role, string[]> = {
  tank: ['Reinhardt', 'Orisa', 'Sigma', 'Winston', 'Zarya', 'D.Va', 'Junker Queen', 'Ramattra', 'Mauga', 'Hazard'],
  damage: ['Tracer', 'Genji', 'Cassidy', 'Soldier: 76', 'Ashe', 'Sojourn', 'Sombra', 'Mei', 'Reaper', 'Echo'],
  support: ['Ana', 'Baptiste', 'Illari', 'Juno', 'Kiriko', 'Lúcio', 'Mercy', 'Moira', 'Zenyatta'],
  openQ: ['Reinhardt', 'Tracer', 'Ana'],
};

const ACCOUNTS = ['Main', 'Smurf', 'Alt', 'Climb'];
const ROLES: Role[] = ['tank', 'damage', 'support'];

const ACCOUNT_WR: Record<string, number> = { Main: 0.56, Smurf: 0.49, Alt: 0.5, Climb: 0.44 };
const ROLE_WR: Record<string, number> = { tank: 0.52, damage: 0.49, support: 0.54, openQ: 0.5 };

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateSampleGames(count = 180, seed = 42): GameRecord[] {
  const rnd = mulberry32(seed);
  const pick = <T>(arr: T[]) => arr[Math.floor(rnd() * arr.length)];
  const between = (lo: number, hi: number) => lo + rnd() * (hi - lo);

  const mapNames = Object.keys(MAPS);
  // Fixed per-map skill modifier so some maps are consistently weak (→ focus panel).
  const mapMod: Record<string, number> = {};
  for (const m of mapNames) mapMod[m] = between(-0.16, 0.16);

  const games: GameRecord[] = [];
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    const account = pick(ACCOUNTS);
    const role = pick(ROLES);
    const map = pick(mapNames);
    const daysAgo = (count - i) / (count / 30); // spread across ~30 days, oldest first
    const timestamp = now - daysAgo * 86400000 - between(0, 6) * 3600000;
    const duration = Math.round(between(7, 16));

    const wr = clamp(ACCOUNT_WR[account] + (ROLE_WR[role] - 0.5) + mapMod[map], 0.2, 0.82);
    const roll = rnd();
    const result: Result = roll < wr ? 'Win' : roll < wr + 0.06 ? 'Draw' : 'Loss';

    const heroCount = rnd() < 0.45 ? 2 : 1;
    const heroPool = HEROES[role];
    const heroes: string[] = [];
    while (heroes.length < heroCount) {
      const h = pick(heroPool);
      if (!heroes.includes(h)) heroes.push(h);
    }
    const perHero = heroes.map((hero) => statLine(hero, role, duration / heroes.length, between));

    games.push({
      matchId: `sample-${i}`,
      timestamp,
      account,
      role,
      map,
      result,
      gameType: 'Competitive',
      durationMinutes: duration,
      heroes,
      perHero,
    });
  }
  return games.sort((a, b) => a.timestamp - b.timestamp);
}

function statLine(hero: string, role: Role, minutes: number, between: (lo: number, hi: number) => number): HeroStat {
  const m = minutes / 10; // scale ranges (defined per ~10 min) by hero's time
  const base = { hero, role, eliminations: 0, deaths: 0, assists: 0, damage: 0, healing: 0, mitigation: 0 };
  if (role === 'tank') {
    return { ...base, eliminations: r(between(14, 26) * m), deaths: r(between(5, 9) * m), assists: r(between(8, 16) * m), damage: r(between(6000, 11000) * m), healing: r(between(0, 800) * m), mitigation: r(between(7000, 14000) * m) };
  }
  if (role === 'support') {
    return { ...base, eliminations: r(between(6, 14) * m), deaths: r(between(4, 8) * m), assists: r(between(16, 28) * m), damage: r(between(3000, 6500) * m), healing: r(between(8000, 15000) * m), mitigation: r(between(0, 1500) * m) };
  }
  return { ...base, eliminations: r(between(18, 32) * m), deaths: r(between(4, 8) * m), assists: r(between(6, 13) * m), damage: r(between(9000, 15000) * m), healing: 0, mitigation: r(between(0, 800) * m) };
}

const r = (n: number) => Math.round(n);
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
