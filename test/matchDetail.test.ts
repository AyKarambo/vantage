import { describe, it, expect } from 'vitest';
import { matchDetail } from '../src/core/matchDetail';
import { generateSampleGames } from '../src/core/sampleData';
import type { GameRecord } from '../src/core/analytics';

/** The bare minimum a legacy history.json record can contain. */
const minimal = (p: Partial<GameRecord> = {}): GameRecord => ({
  matchId: 'legacy-1',
  timestamp: 1_750_000_000_000,
  account: 'Main',
  role: 'damage',
  map: "King's Row",
  result: 'Win',
  gameType: 'Competitive',
  heroes: [],
  ...p,
});

const full = (): GameRecord => ({
  matchId: 'full-1',
  timestamp: 1_750_000_100_000,
  account: 'Main',
  role: 'damage',
  map: 'Dorado',
  result: 'Loss',
  gameType: 'Competitive',
  durationMinutes: 14,
  heroes: ['Tracer', 'Genji'],
  perHero: [
    { hero: 'Tracer', role: 'damage', eliminations: 12, deaths: 4, assists: 3, damage: 6000, healing: 0, mitigation: 0 },
    { hero: 'Genji', role: 'damage', eliminations: 8, deaths: 3, assists: 2, damage: 4000, healing: 0, mitigation: 0 },
  ],
  finalScore: '1–2',
  roster: [
    { battleTag: 'Karambo#21234', heroName: 'Genji', heroRole: 'damage', team: 0, kills: 20, deaths: 7, assists: 5, damage: 10000, healing: 0, mitigation: 0, isLocal: true },
    { battleTag: 'Nova#11214', heroName: 'Ana', heroRole: 'support', team: 0, kills: 4, deaths: 5, assists: 20, damage: 3000, healing: 9000, mitigation: 0 },
    { battleTag: 'Enemy#9', heroName: 'Reinhardt', heroRole: 'tank', team: 1, kills: 14, deaths: 6, assists: 4, damage: 8000, healing: 0, mitigation: 12000 },
  ],
  screenshots: ['full-1/end-of-match.png'],
  mental: { tilt: true },
});

describe('matchDetail degradation contract', () => {
  it('returns null for an unknown matchId', () => {
    expect(matchDetail([minimal()], 'nope')).toBeNull();
    expect(matchDetail([], 'legacy-1')).toBeNull();
  });

  it('a minimal legacy record yields a complete header and absent sections — never throws', () => {
    const d = matchDetail([minimal()], 'legacy-1');
    expect(d).not.toBeNull();
    // Header always renders: every field derives from data all records have.
    expect(d).toMatchObject({
      matchId: 'legacy-1',
      account: 'Main',
      role: 'damage',
      map: "King's Row",
      mapType: 'Hybrid',
      result: 'Win',
      gameType: 'Competitive',
      heroes: [],
    });
    // Optional sections are absent/empty, not faked.
    expect(d!.durationMinutes).toBeUndefined();
    expect(d!.finalScore).toBeUndefined();
    expect(d!.perHero).toEqual([]);
    expect(d!.scoreboard).toBeUndefined();
    expect(d!.playerHistory).toEqual([]);
    expect(d!.screenshots).toEqual([]);
  });

  it('competitive section: estimate for competitive games, absent otherwise', () => {
    const comp = matchDetail([minimal()], 'legacy-1');
    // Single 100%-winrate competitive game → top of the ladder, no range delta.
    expect(comp!.competitive).toMatchObject({ note: 'estimate', tier: 'Champion', division: 1, delta: 0 });
    expect(comp!.competitive?.progressPct).toBeCloseTo(99, 5);

    const qp = matchDetail([minimal({ gameType: 'Quick Play' })], 'legacy-1');
    expect(qp!.competitive).toBeUndefined();
  });

  it('scopes the competitive estimate to the provided context, not the full history', () => {
    const target = minimal({ matchId: 'c-1', result: 'Win', timestamp: 100 });
    const priorLosses = [1, 2, 3, 4].map((i) => minimal({ matchId: `L${i}`, result: 'Loss', timestamp: i }));
    const all = [...priorLosses, target];
    // Context = only the target → 100% winrate → top tier.
    expect(matchDetail(all, 'c-1', [target])!.competitive?.tier).toBe('Champion');
    // Context = the whole history (4 losses + 1 win up to the target) → far lower tier.
    expect(matchDetail(all, 'c-1', all)!.competitive?.tier).not.toBe('Champion');
  });

  it('surfaces the saved review (grades + flags) so the editor can pre-fill, or undefined when ungraded', () => {
    const graded = minimal({ matchId: 'g-1', review: { at: 5, grades: { t1: 'hit' }, flags: { tilt: true } } });
    expect(matchDetail([graded], 'g-1')!.review).toEqual({ at: 5, grades: { t1: 'hit' }, flags: { tilt: true } });
    expect(matchDetail([minimal()], 'legacy-1')!.review).toBeUndefined();
  });

  it('a full record yields the complete payload', () => {
    const priorShared: GameRecord = minimal({
      matchId: 'prior-1',
      timestamp: 1_750_000_000_500,
      result: 'Win',
      roster: [
        { battleTag: 'Karambo#21234', isLocal: true },
        { battleTag: 'nova' }, // bare lowercase — normalizes to Nova#11214
      ],
    });
    const d = matchDetail([priorShared, full()], 'full-1');
    expect(d).not.toBeNull();
    expect(d!.finalScore).toBe('1–2');
    expect(d!.perHero).toHaveLength(2);
    expect(d!.mental).toEqual({ tilt: true });

    // Scoreboard from the stored roster, stats renamed, local flagged, teams kept.
    expect(d!.scoreboard).toHaveLength(3);
    const [local, mate, enemy] = d!.scoreboard!;
    expect(local).toMatchObject({ name: 'Karambo#21234', hero: 'Genji', isLocal: true, team: 0, eliminations: 20, deaths: 7 });
    expect(mate).toMatchObject({ name: 'Nova#11214', role: 'support', isLocal: false, healing: 9000 });
    expect(enemy).toMatchObject({ name: 'Enemy#9', role: 'tank', team: 1, mitigation: 12000 });
    expect(local.perks).toBeUndefined(); // never fabricated — GEP has no perks today

    // Player history spans the whole history.
    expect(d!.playerHistory).toHaveLength(1);
    expect(d!.playerHistory[0]).toMatchObject({ name: 'Nova#11214', encounters: 1 });

    // Screenshots become read-only vantage-media:// URLs.
    expect(d!.screenshots).toEqual(['vantage-media://screenshots/full-1/end-of-match.png']);
  });

  it('falls back to local-only scoreboard rows from perHero when no roster exists', () => {
    const g = minimal({
      matchId: 'per-hero-only',
      heroes: ['Ana'],
      perHero: [{ hero: 'Ana', role: 'support', eliminations: 9, deaths: 4, assists: 21, damage: 3000, healing: 11000, mitigation: 0 }],
    });
    const d = matchDetail([g], 'per-hero-only');
    expect(d!.scoreboard).toHaveLength(1);
    expect(d!.scoreboard![0]).toMatchObject({
      name: 'Main', hero: 'Ana', isLocal: true, healing: 11000,
    });
    expect(d!.scoreboard![0].team).toBeUndefined();
  });

  it('normalizes screenshot paths (backslashes, leading slashes) into URLs', () => {
    const g = minimal({ matchId: 's-1', screenshots: ['s-1\\end-of-match.png'] });
    const d = matchDetail([g], 's-1');
    expect(d!.screenshots).toEqual(['vantage-media://screenshots/s-1/end-of-match.png']);
  });
});

describe('sample dataset detail tiers', () => {
  const games = generateSampleGames(220, 42);

  it('spans every degradation tier deterministically', () => {
    const twoTeams = games.filter((g) => g.roster?.some((p) => p.team === 1));
    const localOnly = games.filter((g) => g.roster?.length && !g.roster.some((p) => p.team === 1));
    const noRoster = games.filter((g) => !g.roster);
    const bareHeader = games.filter((g) => !g.roster && !g.perHero);
    const withScore = games.filter((g) => g.finalScore);

    expect(twoTeams.length).toBeGreaterThan(0);
    expect(localOnly.length).toBeGreaterThan(0);
    expect(noRoster.length).toBeGreaterThan(0);
    expect(bareHeader.length).toBeGreaterThan(0);
    expect(withScore.length).toBeGreaterThan(0);

    // Every roster marks exactly one local entry.
    for (const g of games) {
      if (!g.roster) continue;
      expect(g.roster.filter((p) => p.isLocal)).toHaveLength(1);
    }
  });

  it('every sample game produces a valid detail payload', () => {
    for (const g of games) {
      const d = matchDetail(games, g.matchId);
      expect(d).not.toBeNull();
      expect(d!.mapType).toBeTruthy();
      expect(Array.isArray(d!.playerHistory)).toBe(true);
    }
  });

  it('the recurring player pool yields prior encounters for roster games', () => {
    const rosterGames = games.filter((g) => g.roster?.length);
    const withEncounters = rosterGames.filter(
      (g) => matchDetail(games, g.matchId)!.playerHistory.length > 0,
    );
    expect(withEncounters.length).toBeGreaterThan(0);
  });
});
