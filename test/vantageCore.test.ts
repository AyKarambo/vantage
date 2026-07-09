import { describe, it, expect } from 'vitest';
import type { GameRecord, HeroStat } from '../src/core/analytics';
import type { Result, Role } from '../src/core/model';
import { mapMode } from '../src/core/maps';
import { mentalSummary } from '../src/core/mental';
import { progression, winrateToSr, tierOf } from '../src/core/progression';
import { sampleTargets, type AuthoredTarget } from '../src/core/targets';
import { computeDashboard, applyFilters, pendingReviewMatches } from '../src/core/dashboardData';
import { currentSeasonWindow } from '../src/core/season';
import { isCompetitive } from '../src/core/matchFilter';
import { generateSampleGames } from '../src/core/sampleData';
import { DEFAULT_BREAK_REMINDER } from '../src/core/breakReminder';
import { DEFAULT_SESSION_SETTINGS } from '../src/core/sessionSettings';

function game(p: Partial<GameRecord> & { result: Result; map: string; role: Role }): GameRecord {
  return {
    matchId: Math.random().toString(36).slice(2),
    timestamp: Date.now(),
    account: 'Main',
    gameType: 'Competitive',
    heroes: ['Tracer'],
    ...p,
  };
}

describe('mapMode', () => {
  it('resolves known maps and falls back to Unknown', () => {
    expect(mapMode("King's Row")).toBe('Hybrid');
    expect(mapMode('Ilios')).toBe('Control');
    expect(mapMode('Colosseo')).toBe('Push');
    expect(mapMode('Nonexistent Map')).toBe('Unknown');
  });

  it('resolves the newer maps so imports do not bucket them as Unknown', () => {
    expect(mapMode('Neon Junktion')).toBe('Hybrid');
    expect(mapMode('Redwood Dam')).toBe('Push');
  });

  it('leaves Stadium-only maps unmodelled (they are not in the competitive pool)', () => {
    for (const name of ['Place Lacroix', 'Wuxing University', 'Gogadoro', 'Arena Victoriae']) {
      expect(mapMode(name), name).toBe('Unknown');
    }
  });
});

describe('mentalSummary', () => {
  it('is empty for no games', () => {
    const m = mentalSummary([]);
    expect(m.calm).toBe(0);
    expect(m.tilted).toBe(0);
    expect(m.flags.tilt).toBe(0);
  });

  it('counts flags and splits winrate by tilt', () => {
    const games = [
      game({ result: 'Win', map: 'Ilios', role: 'damage', mental: { tilt: false, positiveComms: true } }),
      game({ result: 'Win', map: 'Ilios', role: 'damage', mental: { tilt: false } }),
      game({ result: 'Loss', map: 'Ilios', role: 'damage', mental: { tilt: true, toxicMates: true } }),
      game({ result: 'Loss', map: 'Ilios', role: 'damage', mental: { tilt: true, leaver: true } }),
    ];
    const m = mentalSummary(games);
    expect(m.flags).toEqual({ tilt: 2, toxicMates: 1, leaver: 1, leaverMyTeam: 1, leaverEnemyTeam: 0, positiveComms: 1, abusive: 0 });
    expect(m.winWhenCalm).toBe(1); // both calm games were wins
    expect(m.winWhenTilted).toBe(0); // both tilted games were losses
    expect(m.calm).toBeGreaterThanOrEqual(0);
    expect(m.tilted).toBeLessThanOrEqual(100);
  });
});

describe('progression', () => {
  it('maps winrate monotonically across the ladder, top → Champion', () => {
    expect(winrateToSr(0.6)).toBeGreaterThan(winrateToSr(0.5));
    expect(winrateToSr(0.4)).toBeLessThan(winrateToSr(0.5));
    expect(tierOf(winrateToSr(1)).tier).toBe('Champion'); // C1/C5: Champion reachable, no clamp to GM
    expect(tierOf(winrateToSr(0)).tier).toBe('Bronze');
  });

  it('maps a rating to tier, division (1–5, 5=lowest) and a 0–100 progress percent', () => {
    const diamond = tierOf(2200);
    expect(diamond.tier).toBe('Diamond');
    expect(diamond.division).toBe(3);
    expect(tierOf(0)).toMatchObject({ tier: 'Bronze', division: 5 });
    const champ = tierOf(3999);
    expect(champ.tier).toBe('Champion');
    expect(champ.division).toBe(1);
    // C2: exact tier-floor + division boundaries (5=lowest band, 1=highest).
    expect(tierOf(499)).toMatchObject({ tier: 'Bronze', division: 1 });
    expect(tierOf(500)).toMatchObject({ tier: 'Silver', division: 5 });
    expect(tierOf(999)).toMatchObject({ tier: 'Silver', division: 1 });
    expect(tierOf(1000)).toMatchObject({ tier: 'Gold', division: 5 });
    expect(tierOf(2099).division).toBe(5);
    expect(tierOf(2100).division).toBe(4);
  });

  it('keeps progressPct within [0,100) across the whole ladder (C3)', () => {
    for (let sr = 0; sr <= 3999; sr += 37) {
      const { division, progressPct } = tierOf(sr);
      expect(division).toBeGreaterThanOrEqual(1);
      expect(division).toBeLessThanOrEqual(5);
      expect(progressPct).toBeGreaterThanOrEqual(0);
      expect(progressPct).toBeLessThan(100); // integer within-division rating < 100 → caps at 99
    }
    // Pin the formula at a known point: top of a division reads ~99%.
    expect(tierOf(2099).progressPct).toBeCloseTo(99, 5);
    expect(tierOf(2000).progressPct).toBeCloseTo(0, 5);
  });

  it('derives a plausible progression from a sample season', () => {
    const p = progression(generateSampleGames(120, 3));
    expect(p.progressPct).toBeGreaterThanOrEqual(0);
    expect(p.progressPct).toBeLessThanOrEqual(100);
    expect(p.division).toBeGreaterThanOrEqual(1);
    expect(p.division).toBeLessThanOrEqual(5);
    expect(p.tier).toBeTypeOf('string');
  });

  it('reports a signed delta in percentage points when the newer half climbs or falls', () => {
    const t = (ts: number, result: Result): GameRecord => game({ result, map: 'Ilios', role: 'damage', timestamp: ts });
    // Older half all losses, newer half all wins → positive delta.
    // Older half 0% (rating 0), newer half 100% (rating 3999) → +3999/DIV_SPAN*100.
    // Pins the magnitude, so a wrong divisor or a dropped ×100 is caught, not just the sign.
    const climbing = [t(1, 'Loss'), t(2, 'Loss'), t(3, 'Win'), t(4, 'Win')];
    expect(progression(climbing).delta).toBeCloseTo(3999, 0);
    const falling = [t(1, 'Win'), t(2, 'Win'), t(3, 'Loss'), t(4, 'Loss')];
    expect(progression(falling).delta).toBeCloseTo(-3999, 0);
    // Fewer than 4 games → no delta.
    expect(progression([t(1, 'Win'), t(2, 'Loss')]).delta).toBe(0);
  });
});

describe('sampleTargets', () => {
  it('produces a bounded, well-formed library', () => {
    const targets = sampleTargets(generateSampleGames(120, 5));
    expect(targets).toHaveLength(4);
    for (const t of targets) {
      expect(t.hitRate).toBeGreaterThanOrEqual(0);
      expect(t.hitRate).toBeLessThanOrEqual(1);
      expect(t.winWhenHit).toBeGreaterThanOrEqual(0);
      expect(t.winWhenHit).toBeLessThanOrEqual(1);
      expect(t.hits).toBeLessThanOrEqual(t.attempts);
      expect(t.spark.length).toBe(8);
      expect(['self', 'measured']).toContain(t.mode);
    }
  });
});

describe('computeDashboard', () => {
  const all = generateSampleGames(180, 7);

  it('returns the full contract shape', () => {
    const d = computeDashboard(all, { days: 'all' }, { active: true, preference: 'on', hasRealHistory: false });
    expect(d.isSample).toBe(true);
    expect(d.demoPreference).toBe('on');
    expect(d.hasRealHistory).toBe(false);
    // Competitive-only scoping (D1): the sample dataset mixes game types, so
    // the visible count is the competitive subset, not the raw 180.
    expect(d.overall.games).toBe(all.filter((g) => isCompetitive(g.gameType)).length);
    expect(d.matches.length).toBeGreaterThan(0);
    expect(d.matches.length).toBeLessThanOrEqual(150);
    expect(d.matches[0].mapType).toBeTypeOf('string');
    expect(d.byMapType.length).toBeGreaterThan(0);
    expect(d.mental.flags).toBeDefined();
    expect(d.mentalCosts.tilt.calm.decided).toBeTypeOf('number');
    expect(d.mentalCosts.leaver.enemy.decided).toBeTypeOf('number');
    expect(Array.isArray(d.tiltTrend)).toBe(true);
    expect(Array.isArray(d.tiltBySession)).toBe(true);
    expect(d.targets).toHaveLength(4);
    expect(d.progression.tier).toBeTypeOf('string');
    expect(d.greetingName).toBeTypeOf('string');
  });

  it('tiltBySession numbers positions over the whole history while the filter scopes aggregation', () => {
    const demo = { active: false, preference: 'off' as const, hasRealHistory: true };
    const t0 = Date.now() - 3 * 60 * 60_000; // one sitting, 3 games 30 min apart
    const sitting = (['support', 'support', 'damage'] as Role[]).map((role, i) =>
      game({
        result: 'Win', map: 'Ilios', role,
        matchId: `sit-${i + 1}`,
        timestamp: t0 + i * 30 * 60_000,
        ...(i === 2 ? { mental: { tilt: true } } : {}),
      }));
    // Filtering to damage keeps only game #3 — it must still report at
    // position '3', not be renumbered to a fresh sitting's game #1.
    const d = computeDashboard(sitting, { days: 'all', role: 'damage' }, demo);
    expect(d.tiltBySession).toEqual([{ key: '3', games: 1, tilted: 1, rate: 1 }]);
  });

  it('defaults breakReminder when ManualData omits it', () => {
    const d = computeDashboard(all, { days: 'all' }, { active: true, preference: 'on', hasRealHistory: false });
    expect(d.breakReminder).toEqual(DEFAULT_BREAK_REMINDER);
  });

  it('threads a provided breakReminder through unchanged', () => {
    const custom = { enabled: false, afterLosses: 5 };
    const d = computeDashboard(all, { days: 'all' }, { active: true, preference: 'on', hasRealHistory: false }, { breakReminder: custom });
    expect(d.breakReminder).toEqual(custom);
  });

  it('surfaces the anchored rank as primaryRank instead of the winrate heuristic', () => {
    const g = (matchId: string, role = 'damage'): GameRecord =>
      ({ matchId, timestamp: 100, account: 'Main', role, map: 'Ilios', result: 'Win', gameType: 'Competitive', heroes: [] } as GameRecord);
    const demo = { active: false, preference: 'off' as const, hasRealHistory: true };

    // Anchor set AFTER the games (setAt > their timestamps) → rank == the anchor.
    const anchors = { 'Main::damage': { tier: 'Gold', division: 3, progressPct: 40, setAt: 1000 } };
    const d = computeDashboard([g('a'), g('b')], { days: 'all' }, demo, { rankAnchors: anchors });
    expect(d.primaryRank).toMatchObject({ account: 'Main', role: 'damage', tier: 'Gold', division: 3, progressPct: 40 });

    // No anchor → primaryRank absent, so the sidebar/KPI fall back to progression.
    expect(computeDashboard([g('a')], { days: 'all' }, demo, {}).primaryRank).toBeUndefined();

    // Multiple anchored roles → the most-played one wins (tank ×2 over support ×1).
    const multi = computeDashboard([g('a', 'tank'), g('b', 'tank'), g('c', 'support')], { days: 'all' }, demo, {
      rankAnchors: {
        'Main::tank': { tier: 'Silver', division: 2, progressPct: 10, setAt: 1000 },
        'Main::support': { tier: 'Diamond', division: 4, progressPct: 90, setAt: 1000 },
      },
    });
    expect(multi.primaryRank).toMatchObject({ role: 'tank', tier: 'Silver' });
  });

  it('scopes primaryRank to the selected account (the sidebar switcher re-points the rank)', () => {
    const g = (matchId: string, account: string): GameRecord =>
      ({ matchId, timestamp: 100, account, role: 'damage', map: 'Ilios', result: 'Win', gameType: 'Competitive', heroes: [] } as GameRecord);
    const demo = { active: false, preference: 'off' as const, hasRealHistory: true };
    const anchors = {
      'Main::damage': { tier: 'Gold', division: 3, progressPct: 40, setAt: 1000 },
      'Smurf::damage': { tier: 'Bronze', division: 5, progressPct: 5, setAt: 1000 },
    };
    // Main is most-played, so 'all' shows Main's rank…
    const games = [g('a', 'Main'), g('b', 'Main'), g('c', 'Smurf')];
    expect(computeDashboard(games, { days: 'all' }, demo, { rankAnchors: anchors }).primaryRank).toMatchObject({ account: 'Main', tier: 'Gold' });
    // …but filtering to Smurf re-points the rank to Smurf.
    expect(computeDashboard(games, { days: 'all', account: 'Smurf' }, demo, { rankAnchors: anchors }).primaryRank).toMatchObject({ account: 'Smurf', tier: 'Bronze' });
  });

  it('re-points primaryRank to the active Role filter when that role is anchored', () => {
    const g = (matchId: string, role = 'damage'): GameRecord =>
      ({ matchId, timestamp: 100, account: 'Main', role, map: 'Ilios', result: 'Win', gameType: 'Competitive', heroes: [] } as GameRecord);
    const demo = { active: false, preference: 'off' as const, hasRealHistory: true };
    const anchors = {
      'Main::tank': { tier: 'Silver', division: 2, progressPct: 10, setAt: 1000 },
      'Main::support': { tier: 'Diamond', division: 4, progressPct: 90, setAt: 1000 },
    };
    const games = [g('a', 'tank'), g('b', 'tank'), g('c', 'support')];
    // No role filter → most-played (tank) wins.
    expect(computeDashboard(games, { days: 'all' }, demo, { rankAnchors: anchors }).primaryRank).toMatchObject({ role: 'tank', tier: 'Silver' });
    // Role filter names the less-played anchored role → it surfaces.
    expect(computeDashboard(games, { days: 'all', role: 'support' }, demo, { rankAnchors: anchors }).primaryRank).toMatchObject({ role: 'support', tier: 'Diamond' });
    // Role filter on an unanchored role → falls back to most-played.
    expect(computeDashboard(games, { days: 'all', role: 'damage' }, demo, { rankAnchors: anchors }).primaryRank).toMatchObject({ role: 'tank' });
  });

  it('session: account "all" lets a cross-account game within the gap threshold join the current session', () => {
    const now = Date.now();
    const g = (matchId: string, account: string, minutesAgo: number): GameRecord =>
      ({ matchId, timestamp: now - minutesAgo * 60_000, account, role: 'damage', map: 'Ilios', result: 'Win', gameType: 'Competitive', heroes: [] } as GameRecord);
    const demo = { active: false, preference: 'off' as const, hasRealHistory: true };
    const games = [g('a', 'Main', 60), g('b', 'Smurf', 30)];
    expect(computeDashboard(games, { days: 'all' }, demo).session).toMatchObject({ games: 2 });
  });

  it('session: a specific account excludes a temporally-adjacent different-account game', () => {
    const now = Date.now();
    const g = (matchId: string, account: string, minutesAgo: number): GameRecord =>
      ({ matchId, timestamp: now - minutesAgo * 60_000, account, role: 'damage', map: 'Ilios', result: 'Win', gameType: 'Competitive', heroes: [] } as GameRecord);
    const demo = { active: false, preference: 'off' as const, hasRealHistory: true };
    const games = [g('a', 'Main', 60), g('b', 'Smurf', 30)];
    expect(computeDashboard(games, { days: 'all', account: 'Main' }, demo).session).toMatchObject({ games: 1 });
  });

  it('session: role and date-range filters do not narrow the computed session', () => {
    const now = Date.now();
    const g = (matchId: string, role: Role, minutesAgo: number): GameRecord =>
      ({ matchId, timestamp: now - minutesAgo * 60_000, account: 'Main', role, map: 'Ilios', result: 'Win', gameType: 'Competitive', heroes: [] } as GameRecord);
    const demo = { active: false, preference: 'off' as const, hasRealHistory: true };
    const games = [g('a', 'tank', 60), g('b', 'support', 30)];
    expect(computeDashboard(games, { days: 'all' }, demo).session).toMatchObject({ games: 2 });
    // A role filter narrows `games`/other fields but must not narrow the session.
    expect(computeDashboard(games, { days: 'all', role: 'tank' }, demo).session).toMatchObject({ games: 2 });
    // Nor does a tight date-range filter.
    expect(computeDashboard(games, { days: 1 }, demo).session).toMatchObject({ games: 2 });
  });

  it('session: uses the configured sessionSettings.gapMinutes as the boundary', () => {
    const now = Date.now();
    const g = (matchId: string, minutesAgo: number): GameRecord =>
      ({ matchId, timestamp: now - minutesAgo * 60_000, account: 'Main', role: 'damage', map: 'Ilios', result: 'Win', gameType: 'Competitive', heroes: [] } as GameRecord);
    const demo = { active: false, preference: 'off' as const, hasRealHistory: true };
    const games = [g('a', 120), g('b', 10)]; // 110-minute gap between them
    // Default threshold (180 min) joins them into one session.
    expect(computeDashboard(games, { days: 'all' }, demo).session).toMatchObject({ games: 2 });
    // A tighter 60-minute threshold splits them.
    expect(computeDashboard(games, { days: 'all' }, demo, { sessionSettings: { gapMinutes: 60 } }).session).toMatchObject({ games: 1 });
  });

  it('threads sessionSettings through unchanged, defaulting to DEFAULT_SESSION_SETTINGS when omitted', () => {
    const demo = { active: false, preference: 'off' as const, hasRealHistory: true };
    expect(computeDashboard(all, { days: 'all' }, demo).sessionSettings).toEqual(DEFAULT_SESSION_SETTINGS);
    const custom = { gapMinutes: 45 };
    expect(computeDashboard(all, { days: 'all' }, demo, { sessionSettings: custom }).sessionSettings).toEqual(custom);
  });

  it('applyFilters narrows by account and role (competitive-only scoping, no mode filter)', () => {
    const byAccount = applyFilters(all, { account: 'Main' });
    expect(byAccount.every((g) => g.account === 'Main')).toBe(true);

    const byRole = applyFilters(all, { role: 'tank' });
    expect(byRole.every((g) => g.role === 'tank')).toBe(true);

    // `mode` is no longer a recognized DashboardFilters key (D1) — applyFilters
    // ignores any extra property and returns the input unfiltered.
    expect(applyFilters(all, {} as never)).toHaveLength(all.length);
  });

  it('respects the day window', () => {
    const recent = applyFilters(all, { days: 7 });
    const cutoff = Date.now() - 7 * 86400000;
    expect(recent.every((g) => g.timestamp >= cutoff)).toBe(true);
    expect(recent.length).toBeLessThanOrEqual(all.length);
  });

  it('reviewInbox/pendingReviews are scoped by role/account but exempt from the day window', () => {
    const demo = { active: false, preference: 'off' as const, hasRealHistory: true };
    const now = Date.now();
    const oldUngraded = game({ result: 'Loss', map: 'Ilios', role: 'damage', account: 'Main', timestamp: now - 200 * 86400000 });
    const wrongRole = game({ result: 'Loss', map: 'Ilios', role: 'tank', account: 'Main', timestamp: now - 5 * 86400000 });
    const wrongAccount = game({ result: 'Loss', map: 'Ilios', role: 'damage', account: 'Smurf', timestamp: now - 5 * 86400000 });
    const games = [oldUngraded, wrongRole, wrongAccount];

    const d = computeDashboard(games, { role: 'damage', account: 'Main', days: 7 }, demo);

    // Role/account narrow the inbox and badge exactly like every other stat...
    const inboxIds = d.reviewInbox.map((m) => m.matchId);
    expect(inboxIds).toContain(oldUngraded.matchId);
    expect(inboxIds).not.toContain(wrongRole.matchId);
    expect(inboxIds).not.toContain(wrongAccount.matchId);
    expect(d.pendingReviews).toBe(1);

    // ...but the day window (7 days) does NOT exclude the 200-day-old match from
    // the inbox/badge, even though it excludes it from every other stat.
    expect(d.matches.map((m) => m.matchId)).not.toContain(oldUngraded.matchId);
  });

  it('pendingReviewMatches forces the day window to "all", ignoring whatever days value is passed', () => {
    const now = Date.now();
    const old = game({ result: 'Loss', map: 'Ilios', role: 'damage', timestamp: now - 400 * 86400000 });
    const recent = game({ result: 'Win', map: 'Ilios', role: 'damage', timestamp: now - 1000 });
    const graded = game({ result: 'Win', map: 'Ilios', role: 'damage', timestamp: now, review: { at: now, grades: {}, flags: {} } });

    const res = pendingReviewMatches([old, recent, graded], { days: 7 });
    expect(res.map((g) => g.matchId)).toEqual([recent.matchId, old.matchId]); // newest first, uncapped
  });

  it('narrows to a specific season via { season: id } ([start, end) boundary)', () => {
    const now = Date.now();
    const w = currentSeasonWindow(now);
    const inSeason = game({ result: 'Win', map: 'Ilios', role: 'damage', timestamp: w.start });
    const justBefore = game({ result: 'Loss', map: 'Ilios', role: 'damage', timestamp: w.start - 1 });
    const justAtEnd = game({ result: 'Loss', map: 'Ilios', role: 'damage', timestamp: w.end });
    const res = applyFilters([inSeason, justBefore, justAtEnd], { days: { season: w.id } });
    expect(res).toContain(inSeason);
    expect(res).not.toContain(justBefore);
    expect(res).not.toContain(justAtEnd); // end is exclusive
  });

  it('falls back to a 30-day window when the season id is unknown/unlistable', () => {
    const now = Date.now();
    const recentGame = game({ result: 'Win', map: 'Ilios', role: 'damage', timestamp: now - 5 * 86400000 });
    const oldGame = game({ result: 'Loss', map: 'Ilios', role: 'damage', timestamp: now - 45 * 86400000 });
    const res = applyFilters([recentGame, oldGame], { days: { season: 'S:not-a-real-id' } });
    expect(res).toContain(recentGame);
    expect(res).not.toContain(oldGame);
  });

  it('buckets the trend daily for a season window, weekly only for all-time/>90d (D2)', () => {
    const demo = { active: false, preference: 'off' as const, hasRealHistory: true };
    const now = Date.now();
    const w = currentSeasonWindow(now);
    // Two games in the same season but different calendar days/ISO weeks so
    // daily vs weekly bucketing produces a different number of trend points.
    const seasonGames = [
      game({ result: 'Win', map: 'Ilios', role: 'damage', timestamp: w.start }),
      game({ result: 'Loss', map: 'Ilios', role: 'damage', timestamp: w.start + 20 * 86400000 }),
    ];
    const seasonTrend = computeDashboard(seasonGames, { days: { season: w.id } }, demo).trend;
    expect(seasonTrend.every((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.key))).toBe(true); // daily keys, not ISO weeks

    const allTimeTrend = computeDashboard(seasonGames, { days: 'all' }, demo).trend;
    expect(allTimeTrend.every((p) => /^\d{4}-W\d{2}$/.test(p.key))).toBe(true); // weekly keys

    const longWindowTrend = computeDashboard(seasonGames, { days: 120 }, demo).trend;
    expect(longWindowTrend.every((p) => /^\d{4}-W\d{2}$/.test(p.key))).toBe(true); // >90d stays weekly
  });

  it('computeDashboard scopes counts/stats to competitive games only (D1)', () => {
    const comp1 = game({ result: 'Win', map: 'Ilios', role: 'damage', gameType: 'Competitive' });
    const comp2 = game({ result: 'Loss', map: 'Ilios', role: 'damage', gameType: 'Competitive' });
    const quickPlay = game({ result: 'Win', map: 'Ilios', role: 'damage', gameType: 'Quick Play' });
    const demo = { active: false, preference: 'off' as const, hasRealHistory: true };
    const d = computeDashboard([comp1, comp2, quickPlay], { days: 'all' }, demo);
    expect(d.overall.games).toBe(2);
    expect(d.totalGamesAllTime).toBe(2);
    expect(d.pendingReviews).toBe(2);
    expect(d.matches.every((m) => m.gameType === 'Competitive')).toBe(true);
  });

  it('emits options.seasons via seasonsForData and no options.modes/filters.mode', () => {
    const demo = { active: false, preference: 'off' as const, hasRealHistory: true };
    const d = computeDashboard(all, { days: 'all' }, demo);
    expect(d.options.seasons.length).toBeGreaterThan(0);
    expect(d.options).not.toHaveProperty('modes');
    expect(d.filters).not.toHaveProperty('mode');
    expect(d).not.toHaveProperty('byMode');
  });

  it('toMatchRow carries srDelta/finalScore/performance when present and omits them when absent', () => {
    const withBoth = game({
      result: 'Win', map: 'Ilios', role: 'damage', srDelta: 25, finalScore: '3–1', performance: 75,
    });
    const withNeither = game({ result: 'Loss', map: 'Ilios', role: 'damage' });
    const demo = { active: false, preference: 'off' as const, hasRealHistory: true };
    const d = computeDashboard([withBoth, withNeither], { days: 'all' }, demo);
    const rowWithBoth = d.matches.find((m) => m.matchId === withBoth.matchId)!;
    const rowWithNeither = d.matches.find((m) => m.matchId === withNeither.matchId)!;
    expect(rowWithBoth.srDelta).toBe(25);
    expect(rowWithBoth.finalScore).toBe('3–1');
    expect(rowWithBoth.performance).toBe(75);
    expect(rowWithNeither).not.toHaveProperty('srDelta');
    expect(rowWithNeither).not.toHaveProperty('finalScore');
    expect(rowWithNeither).not.toHaveProperty('performance');
  });

  it('populates measuredGrades on match-list rows for active measured targets and omits it otherwise (#68)', () => {
    const line: HeroStat = { hero: 'Tracer', role: 'damage', eliminations: 0, deaths: 0, assists: 0, damage: 11000, healing: 0, mitigation: 0 };
    const measurable = game({ result: 'Win', map: 'Ilios', role: 'damage', durationMinutes: 10, perHero: [line] });
    const bare = game({ result: 'Loss', map: 'Ilios', role: 'damage' }); // no stats → 'no-stat'
    const measured: AuthoredTarget = { id: 'dmg', name: 'Damage focus', mode: 'measured', rule: 'Damage ≥ 10,000', createdAt: 0, isActive: true };
    const demo = { active: false, preference: 'off' as const, hasRealHistory: true };

    const withTarget = computeDashboard([measurable, bare], { days: 'all' }, demo, { targets: [measured] });
    const measurableRow = withTarget.matches.find((m) => m.matchId === measurable.matchId)!;
    const bareRow = withTarget.matches.find((m) => m.matchId === bare.matchId)!;
    expect(measurableRow.measuredGrades?.dmg).toEqual({ grade: 'hit', value: 11000 });
    expect(bareRow.measuredGrades?.dmg).toBe('no-stat');

    // No active measured targets → the property is omitted entirely, as before.
    const withoutTarget = computeDashboard([measurable, bare], { days: 'all' }, demo);
    expect(withoutTarget.matches.find((m) => m.matchId === measurable.matchId)).not.toHaveProperty('measuredGrades');
  });

  it('carries the stored self-grades onto match-list rows as targetGrades, independent of active targets (#68 follow-up)', () => {
    const now = Date.now();
    const graded = game({
      result: 'Win', map: 'Ilios', role: 'damage', timestamp: now,
      review: { at: now, grades: { t1: 'hit', t2: 'missed' }, flags: {} },
    });
    const ungraded = game({ result: 'Loss', map: 'Ilios', role: 'damage', timestamp: now - 1000 });
    const demo = { active: false, preference: 'off' as const, hasRealHistory: true };

    // No targets passed at all — the stored grades still ride along, so they stay
    // with the match regardless of whether the targets are still active.
    const d = computeDashboard([graded, ungraded], { days: 'all' }, demo);
    const gradedRow = d.matches.find((m) => m.matchId === graded.matchId)!;
    expect(gradedRow.targetGrades).toEqual({ t1: 'hit', t2: 'missed' });
    expect(d.matches.find((m) => m.matchId === ungraded.matchId)).not.toHaveProperty('targetGrades');
  });

  it('carries performance onto ungraded review-inbox rows so the Review card can seed its slider', () => {
    // An imported / pre-rated game has a performance but no review — it belongs in
    // the inbox, and its rating must ride along so the card shows it (not "Not rated").
    const rated = game({ result: 'Win', map: 'Ilios', role: 'damage', performance: 50 });
    const demo = { active: false, preference: 'off' as const, hasRealHistory: true };
    const d = computeDashboard([rated], { days: 'all' }, demo);
    const inboxRow = d.reviewInbox.find((m) => m.matchId === rated.matchId)!;
    expect(inboxRow).toBeDefined();
    expect(inboxRow.performance).toBe(50);
  });
});
