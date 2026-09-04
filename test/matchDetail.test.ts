import { describe, it, expect } from 'vitest';
import { matchDetail } from '../src/core/matchDetail';
import { generateSampleGames } from '../src/core/sampleData';
import { rankKey, type RankAnchorMap } from '../src/core/rank';
import type { GameRecord } from '../src/core/analytics';
import type { AuthoredTarget } from '../src/core/targets';
import { setupMinutes } from '../src/core/playedTime';

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
  playedMinutes: 14, // measured → the per-10 divisor; the header Duration stays the wall clock
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
    expect(d!.playedMinutes).toBeUndefined();
    expect(d!.playedSource).toBeUndefined();
    expect(d!.finalScore).toBeUndefined();
    expect(d!.perHero).toEqual([]);
    expect(d!.scoreboard).toBeUndefined();
    expect(d!.playerHistory).toEqual([]);
    expect(d!.performance).toBeUndefined();
  });

  it('carries calculated measured-target grades, honoring the partial margin', () => {
    const measured = (rule: string): AuthoredTarget => ({ id: 't', name: 't', mode: 'measured', rule, createdAt: 0, isActive: true });
    const g = full(); // 20 elim over 14 min → 14.3 per 10
    const t = measured('Eliminations ≥ 16');
    const wide = matchDetail([g], g.matchId, [g], {}, undefined, [t], 0.2);
    const tight = matchDetail([g], g.matchId, [g], {}, undefined, [t], 0.1);
    expect(wide?.measuredGrades?.t).toEqual({ grade: 'partial', value: 14.3 }); // 20% band: ≥ 12.8
    expect((tight?.measuredGrades?.t as { grade: string }).grade).toBe('missed'); // 10% band: ≥ 14.4
  });

  it('omits measuredGrades when no active measured targets are supplied', () => {
    expect(matchDetail([full()], 'full-1')!.measuredGrades).toBeUndefined();
  });

  it('surfaces performance when the game has one, omits it otherwise', () => {
    const rated = minimal({ matchId: 'rated-1', performance: 82 });
    expect(matchDetail([rated], 'rated-1')!.performance).toBe(82);
    expect(matchDetail([minimal()], 'legacy-1')!.performance).toBeUndefined();
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

  it('per-match rank note: calculated forward, reconstructed backward, estimate without an anchor', () => {
    const anchors: RankAnchorMap = {
      [rankKey('Main', 'damage')]: { tier: 'Gold', division: 3, progressPct: 40, setAt: 100 },
    };
    const all = [
      minimal({ matchId: 'pre', timestamp: 50, result: 'Win', srDelta: 20 }),
      minimal({ matchId: 'pre2', timestamp: 80, result: 'Loss', srDelta: -10 }),
      minimal({ matchId: 'post', timestamp: 150, result: 'Win', srDelta: 20 }),
    ];

    // Match after the anchor → forward replay, 'calculated'.
    expect(matchDetail(all, 'post', all, anchors)!.competitive).toMatchObject({
      note: 'calculated', tier: 'Gold', division: 3, progressPct: 60, // 40 + 20
    });
    // Match before the anchor → backward reconstruction, 'reconstructed', and it
    // reflects its then-rank (Gold 3 50 = anchor − the −10 loss at pre2), not the anchor.
    expect(matchDetail(all, 'pre', all, anchors)!.competitive).toMatchObject({
      note: 'reconstructed', tier: 'Gold', division: 3, progressPct: 50,
    });
    // No anchor → the winrate estimate.
    expect(matchDetail(all, 'post', all, {})!.competitive!.note).toBe('estimate');
  });

  it('pre-reset: a match before resetBefore reads honestly instead of a fabricated rank', () => {
    const anchors: RankAnchorMap = {
      [rankKey('Main', 'damage')]: { tier: 'Gold', division: 3, progressPct: 40, setAt: 100 },
    };
    const all = [
      minimal({ matchId: 'pre', timestamp: 50, result: 'Win', srDelta: 20 }),
      minimal({ matchId: 'pre2', timestamp: 80, result: 'Loss', srDelta: -10 }),
      minimal({ matchId: 'post', timestamp: 150, result: 'Win', srDelta: 20 }),
    ];
    const resetBefore = 60;

    // Before the reset → 'pre-reset', no tier/division/progressPct, but the
    // match's own logged delta survives; NOT the winrate 'estimate' fallback,
    // which would otherwise still show a made-up rank.
    const pre = matchDetail(all, 'pre', all, anchors, undefined, [], undefined, resetBefore)!.competitive;
    expect(pre).toMatchObject({ note: 'pre-reset', delta: 20 });
    expect(pre!.note).not.toBe('estimate');
    expect(pre!.tier).toBeUndefined();
    expect(pre!.division).toBeUndefined();
    expect(pre!.progressPct).toBeUndefined();
    expect(pre!.protected).toBeUndefined();

    // Still pre-reset, and still not the estimate fallback, even with no anchor at all.
    const preNoAnchor = matchDetail(all, 'pre', all, {}, undefined, [], undefined, resetBefore)!.competitive;
    expect(preNoAnchor!.note).toBe('pre-reset');
    expect(preNoAnchor!.note).not.toBe('estimate');

    // At/after the reset → unaffected, same reconstructed/calculated notes as before.
    expect(matchDetail(all, 'pre2', all, anchors, undefined, [], undefined, resetBefore)!.competitive).toMatchObject({
      note: 'reconstructed', tier: 'Gold', division: 3,
    });
    expect(matchDetail(all, 'post', all, anchors, undefined, [], undefined, resetBefore)!.competitive).toMatchObject({
      note: 'calculated', tier: 'Gold', division: 3, progressPct: 60,
    });

    // Omitting resetBefore entirely reproduces the pre-existing 'reconstructed' behavior.
    expect(matchDetail(all, 'pre', all, anchors)!.competitive).toMatchObject({
      note: 'reconstructed', tier: 'Gold', division: 3, progressPct: 50,
    });
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
  });

  it('orders each team 5v5 (tank, dps, dps, support, support) and derives role from hero when GEP omits it', () => {
    const g = minimal({
      matchId: '5v5-1',
      role: 'support', // the local player's queue role
      roster: [
        { battleTag: 'Mercy#1', heroName: 'Mercy', heroRole: 'support', team: 0 },
        { battleTag: 'Me#1', heroName: 'Ana', team: 0, isLocal: true },
        { battleTag: 'Rein#1', heroName: 'Reinhardt', heroRole: 'tank', team: 0 },
        { battleTag: 'Genji#1', heroName: 'Genji', team: 0 }, // heroRole MISSING → derived from hero
        { battleTag: 'Ashe#1', heroName: 'Ashe', heroRole: 'damage', team: 0 },
        { battleTag: 'Sig#1', heroName: 'Sigma', heroRole: 'tank', team: 1 },
      ],
    });
    const d = matchDetail([g], '5v5-1')!;
    const team0 = d.scoreboard!.filter((e) => e.team === 0).map((e) => e.role);
    expect(team0).toEqual(['tank', 'damage', 'damage', 'support', 'support']);
    // Genji's role was derived from the hero (GEP gave no heroRole).
    expect(d.scoreboard!.find((e) => e.hero === 'Genji')!.role).toBe('damage');
    // Within the support bucket the local player sorts first.
    expect(d.scoreboard!.filter((e) => e.team === 0 && e.role === 'support')[0].isLocal).toBe(true);
    // The tracked player's team renders before the enemy team.
    expect(d.scoreboard!.map((e) => e.team)).toEqual([0, 0, 0, 0, 0, 1]);
  });

  it('merges duplicate same-hero perHero segments at read time (panel + local scoreboard)', () => {
    const dup = minimal({
      matchId: 'dup-1', durationMinutes: 10, playedMinutes: 10, heroes: ['Tracer', 'Genji'],
      perHero: [
        { hero: 'Tracer', role: 'damage', eliminations: 5, deaths: 1, assists: 2, damage: 2000, healing: 0, mitigation: 0, minutes: 3 },
        { hero: 'Genji', role: 'damage', eliminations: 4, deaths: 2, assists: 1, damage: 1500, healing: 0, mitigation: 0, minutes: 2 },
        { hero: 'Tracer', role: 'damage', eliminations: 7, deaths: 1, assists: 3, damage: 3000, healing: 0, mitigation: 0, minutes: 5 },
      ],
    });
    const d = matchDetail([dup], 'dup-1')!;
    expect(d.perHero).toHaveLength(2); // one chip per hero, not three
    expect(d.perHero.find((s) => s.hero === 'Tracer')).toMatchObject({ eliminations: 12, damage: 5000, minutes: 8 });
    // No roster → local-only scoreboard fallback, which merges too.
    expect(d.scoreboard).toHaveLength(2);
  });

  it('carries the played time (the per-10 divisor) next to the wall-clock duration', () => {
    const d = matchDetail([full()], 'full-1')!;
    expect(d.durationMinutes).toBe(14);
    expect(d.playedMinutes).toBe(14);
    expect(d.playedSource).toBe('measured');
  });

  it('ESTIMATE PATH: a legacy 10-minute Ilios capture without playedMinutes is flagged and its hero minutes rescaled', () => {
    // An older GEP capture (no rounds): the divisor is the wall clock minus the
    // hero select (28 s), the scoreboard (40 s) and the Control setup locks for
    // a typical best-of-three (2.5 rounds → 1.5 × 15 s). Swap-timed hero minutes
    // were measured against the wall clock, so they shrink by the same factor.
    const legacy = minimal({
      matchId: 'legacy-ilios', map: 'Ilios', durationMinutes: 10, heroes: ['Tracer', 'Genji'],
      perHero: [
        { hero: 'Tracer', role: 'damage', eliminations: 12, deaths: 2, assists: 5, damage: 5000, healing: 0, mitigation: 0, minutes: 8 },
        { hero: 'Genji', role: 'damage', eliminations: 4, deaths: 2, assists: 1, damage: 1500, healing: 0, mitigation: 0, minutes: 2 },
      ],
    });
    const d = matchDetail([legacy], 'legacy-ilios')!;
    const played = 10 - 68 / 60 - setupMinutes('Control', 2.5);
    expect(d.durationMinutes).toBe(10); // the header's Duration is untouched
    expect(d.playedSource).toBe('estimated');
    expect(d.playedMinutes).toBeCloseTo(played, 9);
    expect(d.perHero.find((s) => s.hero === 'Tracer')!.minutes).toBeCloseTo(8 * (played / 10), 9);
    expect(d.perHero.find((s) => s.hero === 'Genji')!.minutes).toBeCloseTo(2 * (played / 10), 9);
    // The measured-target grade uses the same divisor: 16 elims over the estimated played time.
    const t: AuthoredTarget = { id: 't', name: 't', mode: 'measured', rule: 'Eliminations ≥ 10', createdAt: 0, isActive: true };
    const graded = matchDetail([legacy], 'legacy-ilios', [legacy], {}, undefined, [t])!;
    expect((graded.measuredGrades!.t as { value: number }).value).toBe(Math.round(16 * 10 / played * 10) / 10);
  });

  it('a hand-logged match takes its typed duration as played time ("reported")', () => {
    const manual = minimal({ matchId: 'manual-7', source: 'manual', durationMinutes: 12, heroes: ['Ana'] });
    const d = matchDetail([manual], 'manual-7')!;
    expect(d.playedMinutes).toBe(12);
    expect(d.playedSource).toBe('reported');
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
