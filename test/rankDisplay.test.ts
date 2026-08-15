import { describe, it, expect } from 'vitest';
import {
  rankParts, movementDirOf, rankLabelOf, placementParts, accountPlacementNote, RANK_MOVEMENT_NEUTRAL_THRESHOLD,
} from '../src/core/rankDisplay';
import { computeDashboard } from '../src/core/dashboardData';
import type { GameRecord } from '../src/core/analytics';
import type { Role } from '../src/core/model';

describe('rankDisplay — rankParts', () => {
  it('rankLabel is "Tier Div"', () => {
    expect(rankLabelOf('Master', 2)).toBe('Master 2');
    expect(rankParts({ tier: 'Master', division: 2, progressPct: 45, protected: false }).rankLabel).toBe('Master 2');
  });

  it('shield tracks protection, off by default', () => {
    expect(rankParts({ tier: 'Gold', division: 3, progressPct: 40, protected: false }).shield).toBe(false);
    expect(rankParts({ tier: 'Gold', division: 3, progressPct: -11, protected: true }).shield).toBe(true);
  });

  it('bufferPctText renders normal progress and the negative protection buffer', () => {
    expect(rankParts({ tier: 'Gold', division: 3, progressPct: 45, protected: false }).bufferPctText).toBe('45%');
    // The live client shows a protected loss as e.g. "-11%".
    expect(rankParts({ tier: 'Master', division: 2, progressPct: -11, protected: true }).bufferPctText).toBe('-11%');
    // Rounds like the surfaces used to inline.
    expect(rankParts({ tier: 'Gold', division: 3, progressPct: 62.4, protected: false }).bufferPctText).toBe('62%');
  });

  it('movementDir is populated ONLY when movement is supplied', () => {
    // No movement input → no arrow anywhere but the Overview KPI.
    expect(rankParts({ tier: 'Gold', division: 3, progressPct: 40, protected: false }).movementDir).toBeUndefined();
    // Supplied → classified.
    expect(rankParts({ tier: 'Gold', division: 3, progressPct: 40, protected: false, movement: 70 }).movementDir).toBe('up');
    expect(rankParts({ tier: 'Gold', division: 3, progressPct: 40, protected: false, movement: -120 }).movementDir).toBe('down');
    expect(rankParts({ tier: 'Gold', division: 3, progressPct: 40, protected: false, movement: 0 }).movementDir).toBe('neutral');
  });

  it('edge cases: movement of exactly 0 (or exactly the threshold) reads neutral, not up', () => {
    expect(rankParts({ tier: 'Gold', division: 3, progressPct: 40, protected: false, movement: 0 }).movementDir).toBe('neutral');
    expect(rankParts({ tier: 'Gold', division: 3, progressPct: 40, protected: true, movement: -5 }).movementDir).toBe('neutral');
  });
});

describe('rankDisplay — placementParts', () => {
  it('counter reads "Placements N/10" regardless of prediction', () => {
    expect(placementParts(4, 10).counter).toBe('Placements 4/10');
    expect(placementParts(0, 10).counter).toBe('Placements 0/10');
    expect(placementParts(10, 10, { tier: 'Platinum', division: 4 }).counter).toBe('Placements 10/10');
  });

  it('predictionLabel is absent until a prediction exists, then reuses rankLabelOf + "(predicted)"', () => {
    expect(placementParts(4, 10).predictionLabel).toBeUndefined();
    expect(placementParts(4, 10, { tier: 'Platinum', division: 4 }).predictionLabel).toBe('Platinum 4 (predicted)');
  });

  it('carries no shield, percentage or movement — placements deliberately have none of those (see JSDoc)', () => {
    const p = placementParts(4, 10, { tier: 'Platinum', division: 4 });
    expect(p).not.toHaveProperty('shield');
    expect(p).not.toHaveProperty('bufferPctText');
    expect(p).not.toHaveProperty('movementDir');
  });

  it('awaitingRank true sets awaitingLabel and omits predictionLabel even when a prediction is passed', () => {
    const p = placementParts(10, 10, { tier: 'Platinum', division: 4 }, true);
    expect(p.awaitingLabel).toBe('confirm your rank');
    expect(p).not.toHaveProperty('predictionLabel');
  });

  it('awaitingRank false (the default) behaves exactly as before: no awaitingLabel, prediction still shown', () => {
    const withoutArg = placementParts(4, 10, { tier: 'Platinum', division: 4 });
    expect(withoutArg).not.toHaveProperty('awaitingLabel');
    expect(withoutArg.predictionLabel).toBe('Platinum 4 (predicted)');

    const explicitFalse = placementParts(4, 10, { tier: 'Platinum', division: 4 }, false);
    expect(explicitFalse).not.toHaveProperty('awaitingLabel');
    expect(explicitFalse.predictionLabel).toBe('Platinum 4 (predicted)');
  });
});

describe('rankDisplay — accountPlacementNote', () => {
  it('no open runs → undefined', () => {
    expect(accountPlacementNote([])).toBeUndefined();
    expect(accountPlacementNote([{ counted: 10, target: 10, completed: true, awaitingRank: false }])).toBeUndefined();
  });

  it('any open run awaiting rank confirmation → "confirm your rank", regardless of other open runs', () => {
    expect(accountPlacementNote([{ counted: 10, target: 10, completed: false, awaitingRank: true }])).toBe('confirm your rank');
    expect(accountPlacementNote([
      { counted: 4, target: 10, completed: false, awaitingRank: false },
      { counted: 10, target: 10, completed: false, awaitingRank: true },
    ])).toBe('confirm your rank');
  });

  it('exactly one open run, not awaiting → "placements N/target" (lowercase, a suffix not a heading)', () => {
    expect(accountPlacementNote([{ counted: 4, target: 10, completed: false, awaitingRank: false }])).toBe('placements 4/10');
  });

  it('more than one open run, none awaiting → "N tracks in placements"', () => {
    expect(accountPlacementNote([
      { counted: 4, target: 10, completed: false, awaitingRank: false },
      { counted: 7, target: 10, completed: false, awaitingRank: false },
    ])).toBe('2 tracks in placements');
  });

  it('completed runs are ignored entirely — only OPEN runs count and count toward the tally', () => {
    expect(accountPlacementNote([
      { counted: 10, target: 10, completed: true, awaitingRank: false },
      { counted: 4, target: 10, completed: false, awaitingRank: false },
    ])).toBe('placements 4/10');
    expect(accountPlacementNote([
      { counted: 10, target: 10, completed: true, awaitingRank: true },
    ])).toBeUndefined();
  });
});

describe('rankDisplay — movementDirOf threshold', () => {
  it('classifies around the ±threshold band', () => {
    expect(RANK_MOVEMENT_NEUTRAL_THRESHOLD).toBe(10);
    expect(movementDirOf(RANK_MOVEMENT_NEUTRAL_THRESHOLD)).toBe('neutral'); // boundary is inclusive-neutral
    expect(movementDirOf(RANK_MOVEMENT_NEUTRAL_THRESHOLD + 0.5)).toBe('up');
    expect(movementDirOf(-RANK_MOVEMENT_NEUTRAL_THRESHOLD)).toBe('neutral');
    expect(movementDirOf(-RANK_MOVEMENT_NEUTRAL_THRESHOLD - 0.5)).toBe('down');
    expect(movementDirOf(0)).toBe('neutral');
  });
});

describe('primaryRank movement — anchor → now, truthful direction (no hard-coded up)', () => {
  const g = (p: Partial<GameRecord> & { srDelta: number; timestamp: number }): GameRecord => ({
    matchId: Math.random().toString(36).slice(2),
    account: 'Main', role: 'damage' as Role, map: 'Ilios',
    result: 'Win', gameType: 'Competitive', heroes: [],
    ...p,
  });
  const demo = { active: false, preference: 'off' as const, hasRealHistory: true };
  // Anchor set BEFORE the games (setAt=0), so the games move the rank forward.
  const anchors = { 'Main::damage': { tier: 'Gold', division: 3, progressPct: 40, setAt: 0 } };

  it('rising history → positive movement → up', () => {
    const d = computeDashboard([g({ srDelta: 30, timestamp: 100, result: 'Win' })], { days: 'all' }, demo, { rankAnchors: anchors });
    expect(d.primaryRank!.movement).toBeGreaterThan(0);
    expect(rankParts({ ...d.primaryRank!, movement: d.primaryRank!.movement }).movementDir).toBe('up');
  });

  it('falling history → negative movement → down (NOT a false up)', () => {
    const d = computeDashboard([g({ srDelta: -30, timestamp: 100, result: 'Loss' })], { days: 'all' }, demo, { rankAnchors: anchors });
    expect(d.primaryRank!.movement).toBeLessThan(0);
    expect(rankParts({ ...d.primaryRank!, movement: d.primaryRank!.movement }).movementDir).toBe('down');
  });

  it('no matches since the anchor → zero movement → neutral', () => {
    // Anchor set AFTER the (pre-anchor) game, so nothing replays forward → rank == anchor.
    const late = { 'Main::damage': { tier: 'Gold', division: 3, progressPct: 40, setAt: 1000 } };
    const d = computeDashboard([g({ srDelta: 20, timestamp: 100, result: 'Win' })], { days: 'all' }, demo, { rankAnchors: late });
    expect(d.primaryRank!.movement).toBe(0);
    expect(rankParts({ ...d.primaryRank!, movement: d.primaryRank!.movement }).movementDir).toBe('neutral');
  });

  it('movement is independent of the active date filter (measured over full history)', () => {
    const games = [g({ srDelta: 30, timestamp: 100, result: 'Win' })];
    const all = computeDashboard(games, { days: 'all' }, demo, { rankAnchors: anchors });
    const windowed = computeDashboard(games, { days: 7 }, demo, { rankAnchors: anchors });
    expect(windowed.primaryRank!.movement).toBe(all.primaryRank!.movement);
  });
});

describe('accountRanks — per-account rank for the switcher popover', () => {
  const g = (account: string, role: Role = 'damage'): GameRecord => ({
    matchId: Math.random().toString(36).slice(2),
    account, role, map: 'Ilios', timestamp: 100,
    result: 'Win', gameType: 'Competitive', heroes: [],
  });
  const demo = { active: false, preference: 'off' as const, hasRealHistory: true };

  it('maps each anchored account to its most-played anchored role rank; no anchor → absent', () => {
    const anchors = {
      'Main::damage': { tier: 'Gold', division: 3, progressPct: 40, setAt: 1000 },
      'Smurf::tank': { tier: 'Bronze', division: 5, progressPct: 5, setAt: 1000 },
    };
    const d = computeDashboard([g('Main'), g('Smurf', 'tank'), g('NoRank')], { days: 'all' }, demo, { rankAnchors: anchors });
    expect(d.accountRanks['Main']).toMatchObject({ tier: 'Gold', division: 3, protected: false });
    expect(d.accountRanks['Smurf']).toMatchObject({ tier: 'Bronze', division: 5 });
    expect(d.accountRanks['NoRank']).toBeUndefined();
  });

  it('is an empty map when no anchors exist at all', () => {
    const d = computeDashboard([g('Main')], { days: 'all' }, demo, {});
    expect(d.accountRanks).toEqual({});
  });
});
