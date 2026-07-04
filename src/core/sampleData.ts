import type { GameRecord, HeroStat } from './analytics';
import type { Result, Role, RosterPlayer } from './model';
import { MAP_MODES } from './maps';

/**
 * Generates a realistic season of games (deterministic, seeded) so the dashboard
 * has something to show while live GEP is pending approval. The same
 * `GameRecord` shape is produced from GEP at runtime.
 */

const MAPS = MAP_MODES;

const HEROES: Record<Role, string[]> = {
  tank: ['Reinhardt', 'Orisa', 'Sigma', 'Winston', 'Zarya', 'D.Va', 'Junker Queen', 'Ramattra', 'Mauga', 'Hazard'],
  damage: ['Tracer', 'Genji', 'Cassidy', 'Soldier: 76', 'Ashe', 'Sojourn', 'Sombra', 'Mei', 'Reaper', 'Echo'],
  support: ['Ana', 'Baptiste', 'Illari', 'Juno', 'Kiriko', 'Lúcio', 'Mercy', 'Moira', 'Zenyatta'],
  openQ: ['Reinhardt', 'Tracer', 'Ana'],
};

const ACCOUNTS = ['Main', 'Smurf', 'Alt', 'Climb'];
const ROLES: Role[] = ['tank', 'damage', 'support'];

/** Role-queue team composition used for sample rosters. */
const ROSTER_ROLES: Role[] = ['tank', 'damage', 'damage', 'support', 'support'];

/**
 * A small recurring pool of other players so the Player History index has
 * repeat encounters to find. A few entries deliberately lack the `#`
 * discriminator to exercise name normalization.
 */
const PLAYER_POOL = [
  'Nova#11214', 'Vex#2321', 'Mirage#1123', 'Falcon#21500', 'Kestrel#1441',
  'Onyx#3110', 'Drift#1998', 'Pixel', 'Rune#11841', 'Saber#2280',
  'Willow#1373', 'Ghost#21058', 'Ember#1550', 'Frost#31240', 'Blitz',
  'Lyric#1216', 'Quartz#1899', 'Havoc#23041', 'Zephyr#1002', 'Ash#31217',
];

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
    const gt = rnd();
    const gameType = gt < 0.68 ? 'Competitive' : gt < 0.92 ? 'Quick Play' : 'Arcade';

    const heroCount = rnd() < 0.45 ? 2 : 1;
    const heroPool = HEROES[role];
    const heroes: string[] = [];
    while (heroes.length < heroCount) {
      const h = pick(heroPool);
      if (!heroes.includes(h)) heroes.push(h);
    }
    const perHero = heroes.map((hero) => statLine(hero, role, duration / heroes.length, between));

    // Data-tier mix — the detail page must degrade gracefully, so the demo
    // season deliberately spans every capture tier: full two-team roster with
    // a round score, local-team-only roster, and legacy records with neither
    // (a slice of which also lack per-hero data, the bare-header tier).
    const tier = rnd();
    let roster: RosterPlayer[] | undefined;
    let finalScore: string | undefined;
    let perHeroOut: HeroStat[] | undefined = perHero;
    if (tier < 0.4) {
      roster = sampleRoster(account, role, heroes, perHero, duration, true, rnd, between);
      finalScore = sampleScore(result, rnd);
    } else if (tier < 0.7) {
      roster = sampleRoster(account, role, heroes, perHero, duration, false, rnd, between);
      if (rnd() < 0.5) finalScore = sampleScore(result, rnd);
    } else if (rnd() < 0.25) {
      perHeroOut = undefined;
    }

    // Manual (◎) after-game self-report — tilt clusters on losses, positive
    // comms is common. Deterministic via the same seeded stream.
    const mental = {
      tilt: result === 'Loss' ? rnd() < 0.42 : rnd() < 0.12,
      toxicMates: rnd() < 0.16,
      leaver: rnd() < 0.05,
      positiveComms: rnd() < 0.46,
    };

    games.push({
      matchId: `sample-${i}`,
      timestamp,
      account,
      role,
      map,
      result,
      gameType,
      durationMinutes: duration,
      heroes,
      perHero: perHeroOut,
      finalScore,
      roster,
      mental,
    });
  }
  return games.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * A believable GEP-style roster: the local player's line plus teammates drawn
 * from the recurring pool; optionally a second (enemy) team when `withTeams`.
 */
function sampleRoster(
  account: string,
  role: Role,
  heroes: string[],
  perHero: HeroStat[],
  duration: number,
  withTeams: boolean,
  rnd: () => number,
  between: (lo: number, hi: number) => number,
): RosterPlayer[] {
  const pick = <T>(arr: T[]) => arr[Math.floor(rnd() * arr.length)];
  const used = new Set<string>();
  const nextName = (): string => {
    let name = pick(PLAYER_POOL);
    let guard = 0;
    while (used.has(name) && guard++ < 40) name = pick(PLAYER_POOL);
    used.add(name);
    return name;
  };

  const roster: RosterPlayer[] = [];
  let localPlaced = false;
  for (let team = 0; team < (withTeams ? 2 : 1); team++) {
    for (const slotRole of ROSTER_ROLES) {
      if (team === 0 && !localPlaced && (slotRole === role || role === 'openQ')) {
        localPlaced = true;
        const totals = sumStats(perHero);
        roster.push({
          battleTag: `${account}#${1000 + Math.floor(rnd() * 9000)}`,
          heroName: heroes[heroes.length - 1],
          heroRole: role === 'openQ' ? slotRole : role,
          team: withTeams ? 0 : undefined,
          ...totals,
          isLocal: true,
        });
        continue;
      }
      const hero = pick(HEROES[slotRole]);
      const s = statLine(hero, slotRole, duration, between);
      roster.push({
        battleTag: nextName(),
        heroName: hero,
        heroRole: slotRole,
        team: withTeams ? team : undefined,
        kills: s.eliminations,
        deaths: s.deaths,
        assists: s.assists,
        damage: s.damage,
        healing: s.healing,
        mitigation: s.mitigation,
      });
    }
  }
  return roster;
}

function sumStats(perHero: HeroStat[]): Pick<RosterPlayer, 'kills' | 'deaths' | 'assists' | 'damage' | 'healing' | 'mitigation'> {
  const sum = (get: (s: HeroStat) => number) => perHero.reduce((acc, s) => acc + get(s), 0);
  return {
    kills: sum((s) => s.eliminations),
    deaths: sum((s) => s.deaths),
    assists: sum((s) => s.assists),
    damage: sum((s) => s.damage),
    healing: sum((s) => s.healing),
    mitigation: sum((s) => s.mitigation),
  };
}

/** Round score consistent with the result, e.g. Win → "2–1". */
function sampleScore(result: Result, rnd: () => number): string {
  if (result === 'Draw') return '2–2';
  const winner = rnd() < 0.3 ? 3 : 2;
  const loser = Math.max(0, winner - 1 - Math.floor(rnd() * 2));
  return result === 'Win' ? `${winner}–${loser}` : `${loser}–${winner}`;
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
