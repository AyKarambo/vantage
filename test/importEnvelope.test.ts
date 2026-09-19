import { describe, it, expect } from 'vitest';
import { parseVantageImport, buildImportEnvelope, type BackupData } from '../src/core/importEnvelope';
import type { GameRecord } from '../src/core/analytics';
import type { AuthoredTarget } from '../src/core/targets';
import type { RankAnchorMap } from '../src/core/rank';

const now = () => 2_000_000_000_000; // fixed "now" for deterministic clamping

function envelope(over: Record<string, unknown> = {}) {
  return {
    vantageImport: 1,
    account: 'Lampenlicht',
    games: [
      { matchId: 'manual-import-a', timestamp: 1_700_000_000_000, map: 'Busan', result: 'Loss', heroes: ['Winston', 'Sigma'], srDelta: -27, performance: 75 },
    ],
    ...over,
  };
}

describe('parseVantageImport — happy path', () => {
  it('maps a valid row to a manual GameRecord with envelope defaults', () => {
    const { games, errors } = parseVantageImport(envelope(), { now });
    expect(errors).toEqual([]);
    expect(games).toHaveLength(1);
    expect(games[0]).toEqual({
      matchId: 'manual-import-a',
      timestamp: 1_700_000_000_000,
      account: 'Lampenlicht',
      role: 'tank',
      map: 'Busan',
      result: 'Loss',
      gameType: 'Competitive',
      source: 'manual',
      heroes: ['Winston', 'Sigma'],
      srDelta: -27,
      performance: 75,
    });
  });

  it('keeps srDelta:0 (a recorded no-movement match)', () => {
    const { games } = parseVantageImport(envelope({
      games: [{ matchId: 'z', timestamp: 1, map: 'Ilios', result: 'Win', srDelta: 0 }],
    }), { now });
    expect(games[0].srDelta).toBe(0);
  });

  it('accepts the full 0/25/50/75/100 performance range', () => {
    const rows = [0, 25, 50, 75, 100].map((p, i) => ({ matchId: `p${i}`, timestamp: 1, map: 'Ilios', result: 'Win', performance: p }));
    const { games } = parseVantageImport(envelope({ games: rows }), { now });
    expect(games.map((g) => g.performance)).toEqual([0, 25, 50, 75, 100]);
  });

  it('clamps a future timestamp to now', () => {
    const { games } = parseVantageImport(envelope({
      games: [{ matchId: 'future', timestamp: 9_999_999_999_999, map: 'Ilios', result: 'Win' }],
    }), { now });
    expect(games[0].timestamp).toBe(now());
  });

  it('preserves the exact matchId (deterministic re-import key)', () => {
    const { games } = parseVantageImport(envelope(), { now });
    expect(games[0].matchId).toBe('manual-import-a');
  });

  it('defaults role=tank, gameType=Competitive, heroes=[] when omitted', () => {
    const { games } = parseVantageImport(envelope({
      games: [{ matchId: 'bare', timestamp: 1, map: 'Ilios', result: 'Win' }],
    }), { now });
    expect(games[0]).toMatchObject({ role: 'tank', gameType: 'Competitive', heroes: [] });
  });

  it('accepts a case-insensitive role', () => {
    const { games } = parseVantageImport(envelope({
      games: [{ matchId: 'x', timestamp: 1, map: 'Ilios', result: 'Win', role: 'Support' }],
    }), { now });
    expect(games[0].role).toBe('support');
  });

  it('drops an out-of-range performance value (keeps the game)', () => {
    const { games } = parseVantageImport(envelope({
      games: [
        { matchId: 'hi', timestamp: 1, map: 'Ilios', result: 'Win', performance: 500 },
        { matchId: 'lo', timestamp: 1, map: 'Ilios', result: 'Win', performance: -20 },
      ],
    }), { now });
    expect(games.map((g) => g.matchId)).toEqual(['hi', 'lo']);
    expect(games.every((g) => g.performance === undefined)).toBe(true);
  });
});

describe('parseVantageImport — per-row rejection (never throws)', () => {
  it('rejects a row with no decidable result and keeps the good ones', () => {
    const { games, errors } = parseVantageImport(envelope({
      games: [
        { matchId: 'ok', timestamp: 1, map: 'Ilios', result: 'Win' },
        { matchId: 'bad', timestamp: 1, map: 'Ilios' }, // no result
      ],
    }), { now });
    expect(games.map((g) => g.matchId)).toEqual(['ok']);
    expect(errors).toEqual([{ index: 1, reason: expect.stringMatching(/result/i) }]);
  });

  it('rejects a row without a matchId', () => {
    const { games, errors } = parseVantageImport(envelope({
      games: [{ timestamp: 1, map: 'Ilios', result: 'Win' }],
    }), { now });
    expect(games).toHaveLength(0);
    expect(errors[0].reason).toMatch(/matchId/i);
  });

  it('rejects a row with an invalid timestamp', () => {
    const { games, errors } = parseVantageImport(envelope({
      games: [{ matchId: 'x', timestamp: 'nope', map: 'Ilios', result: 'Win' }],
    }), { now });
    expect(games).toHaveLength(0);
    expect(errors[0].reason).toMatch(/timestamp/i);
  });

  it('rejects a row with a present-but-unrecognized role (no silent tank default)', () => {
    const { games, errors } = parseVantageImport(envelope({
      games: [{ matchId: 'x', timestamp: 1, map: 'Ilios', result: 'Win', role: 'healer' }],
    }), { now });
    expect(games).toHaveLength(0);
    expect(errors[0].reason).toMatch(/role/i);
  });

  it('rejects a row with no account and no envelope default', () => {
    const { games, errors } = parseVantageImport({
      vantageImport: 1,
      games: [{ matchId: 'x', timestamp: 1, map: 'Ilios', result: 'Win' }],
    }, { now });
    expect(games).toHaveLength(0);
    expect(errors[0].reason).toMatch(/account/i);
  });
});

describe('parseVantageImport — envelope-level validation', () => {
  it('returns a single error for a non-object', () => {
    expect(parseVantageImport(null, { now })).toEqual({ games: [], errors: [{ index: null, reason: expect.any(String) }] });
    expect(parseVantageImport('nope', { now }).games).toEqual([]);
  });

  it('errors when games is not an array', () => {
    const { games, errors } = parseVantageImport({ vantageImport: 1, account: 'X', games: {} }, { now });
    expect(games).toEqual([]);
    expect(errors.some((e) => /games.*array/i.test(e.reason))).toBe(true);
  });

  it('flags a missing version but still imports valid rows', () => {
    const { games, errors } = parseVantageImport({
      account: 'Lampenlicht',
      games: [{ matchId: 'a', timestamp: 1, map: 'Ilios', result: 'Win' }],
    }, { now });
    expect(games).toHaveLength(1);
    expect(errors.some((e) => /vantageImport/i.test(e.reason))).toBe(true);
  });
});

describe('parseVantageImport — anchor', () => {
  it('returns a valid anchor', () => {
    const { anchor, errors } = parseVantageImport(envelope({
      anchor: { role: 'tank', tier: 'Diamond', division: 3, progressPct: 45 },
    }), { now });
    expect(anchor).toEqual({ role: 'tank', tier: 'Diamond', division: 3, progressPct: 45 });
    expect(errors).toEqual([]);
  });

  it('drops an anchor with an unknown tier (+ reports it)', () => {
    const { anchor, errors } = parseVantageImport(envelope({
      anchor: { role: 'tank', tier: 'Titanium', division: 3, progressPct: 45 },
    }), { now });
    expect(anchor).toBeUndefined();
    expect(errors[0].reason).toMatch(/tier/i);
  });

  it('drops an anchor with an out-of-range division', () => {
    const { anchor, errors } = parseVantageImport(envelope({
      anchor: { role: 'tank', tier: 'Diamond', division: 6, progressPct: 45 },
    }), { now });
    expect(anchor).toBeUndefined();
    expect(errors[0].reason).toMatch(/division/i);
  });

  it('drops an anchor with an out-of-range progressPct', () => {
    const { anchor, errors } = parseVantageImport(envelope({
      anchor: { role: 'tank', tier: 'Diamond', division: 3, progressPct: 120 },
    }), { now });
    expect(anchor).toBeUndefined();
    expect(errors[0].reason).toMatch(/progress/i);
  });

  it('drops an anchor with an unrecognized role', () => {
    const { anchor, errors } = parseVantageImport(envelope({
      anchor: { role: 'healer', tier: 'Diamond', division: 3, progressPct: 45 },
    }), { now });
    expect(anchor).toBeUndefined();
    expect(errors[0].reason).toMatch(/role/i);
  });

  it('imports games normally when no anchor is present', () => {
    const { anchor, games } = parseVantageImport(envelope(), { now });
    expect(anchor).toBeUndefined();
    expect(games).toHaveLength(1);
  });
});

// ---- W3 phase 2: v2 full backup ------------------------------------------------

describe('parseVantageImport — v2 games preserve review/mental (W3)', () => {
  it('reads mental and review back onto the game, unlike a v1 file', () => {
    const { games, errors } = parseVantageImport(envelope({
      vantageImport: 2,
      games: [{
        matchId: 'a', timestamp: 1, map: 'Ilios', result: 'Win',
        mental: { tilt: true, comms: 'positive' },
        review: { at: 1000, grades: { t1: 'hit', t2: 'missed' }, flags: { toxicMates: true } },
      }],
    }), { now });
    expect(errors).toEqual([]);
    expect(games[0].mental).toEqual({ tilt: true, comms: 'positive' });
    expect(games[0].review).toEqual({ at: 1000, grades: { t1: 'hit', t2: 'missed' }, flags: { toxicMates: true } });
  });

  it('drops unrecognized comms/grade values rather than failing the row', () => {
    const { games, errors } = parseVantageImport(envelope({
      games: [{
        matchId: 'a', timestamp: 1, map: 'Ilios', result: 'Win',
        mental: { comms: 'sarcastic' },
        review: { at: 1000, grades: { t1: 'sort-of' } },
      }],
    }), { now });
    expect(errors).toEqual([]);
    expect(games[0].mental).toBeUndefined(); // comms was the only field, and it was invalid
    expect(games[0].review).toEqual({ at: 1000, grades: {}, flags: {} });
  });

  it('omits mental/review entirely when the row has neither (v1 files, unaffected)', () => {
    const { games } = parseVantageImport(envelope(), { now });
    expect(games[0].mental).toBeUndefined();
    expect(games[0].review).toBeUndefined();
  });
});

describe('parseVantageImport — v2 accounts/rankAnchors/targets sections', () => {
  it('parses a valid accounts array', () => {
    const { accounts, errors } = parseVantageImport(envelope({
      accounts: [{ battleTag: 'You#1234', label: 'Main' }, { battleTag: 'Alt#9999', label: 'Smurf' }],
    }), { now });
    expect(errors).toEqual([]);
    expect(accounts).toEqual([{ battleTag: 'You#1234', label: 'Main' }, { battleTag: 'Alt#9999', label: 'Smurf' }]);
  });

  it('falls back to the battleTag as the label when label is missing', () => {
    const { accounts } = parseVantageImport(envelope({ accounts: [{ battleTag: 'You#1234' }] }), { now });
    expect(accounts).toEqual([{ battleTag: 'You#1234', label: 'You#1234' }]);
  });

  it('drops an account with no battleTag and reports it', () => {
    const { accounts, errors } = parseVantageImport(envelope({ accounts: [{ label: 'Main' }] }), { now });
    expect(accounts).toEqual([]);
    expect(errors.some((e) => /account/i.test(e.reason) && /battleTag/i.test(e.reason))).toBe(true);
  });

  it('parses a valid rankAnchors array, one entry per (account, role)', () => {
    const { rankAnchors, errors } = parseVantageImport(envelope({
      rankAnchors: [
        { account: 'Main', role: 'damage', tier: 'Gold', division: 3, progressPct: 40, setAt: 500 },
        { account: 'Main', role: 'tank', tier: 'Silver', division: 5, progressPct: 10, setAt: 600 },
      ],
    }), { now });
    expect(errors).toEqual([]);
    expect(rankAnchors).toEqual([
      { account: 'Main', role: 'damage', tier: 'Gold', division: 3, progressPct: 40, setAt: 500 },
      { account: 'Main', role: 'tank', tier: 'Silver', division: 5, progressPct: 10, setAt: 600 },
    ]);
  });

  it('drops a rank anchor with no account, or an invalid tier, keeping the rest', () => {
    const { rankAnchors, errors } = parseVantageImport(envelope({
      rankAnchors: [
        { role: 'damage', tier: 'Gold', division: 3, progressPct: 40, setAt: 500 }, // no account
        { account: 'Main', role: 'tank', tier: 'Titanium', division: 3, progressPct: 40, setAt: 500 }, // bad tier
        { account: 'Main', role: 'support', tier: 'Gold', division: 3, progressPct: 40, setAt: 500 }, // good
      ],
    }), { now });
    expect(rankAnchors).toEqual([{ account: 'Main', role: 'support', tier: 'Gold', division: 3, progressPct: 40, setAt: 500 }]);
    expect(errors).toHaveLength(2);
  });

  it('parses a valid targets array', () => {
    const target = { id: 't1', name: 'Hold cover', mode: 'self', rule: 'stay behind cover', createdAt: 100, isActive: true };
    const { targets, errors } = parseVantageImport(envelope({ targets: [target] }), { now });
    expect(errors).toEqual([]);
    expect(targets).toEqual([target]);
  });

  it('carries optional target fields (scope, roleScope, heroScope, mapScope, activatedAt, archivedAt) when present', () => {
    const target = {
      id: 't1', name: 'Hold cover', mode: 'measured', rule: 'r', createdAt: 100, isActive: false,
      scope: 'season', roleScope: 'tank', heroScope: ['Reinhardt'], mapScope: ['Ilios'], activatedAt: 150, archivedAt: 200,
    };
    const { targets } = parseVantageImport(envelope({ targets: [target] }), { now });
    expect(targets).toEqual([target]);
  });

  it('drops a target missing required fields, keeping the rest', () => {
    const good = { id: 't1', name: 'Hold cover', mode: 'self', rule: 'r', createdAt: 100, isActive: true };
    const bad = { id: 't2', name: 'No mode', rule: 'r', createdAt: 100, isActive: true };
    const { targets, errors } = parseVantageImport(envelope({ targets: [bad, good] }), { now });
    expect(targets).toEqual([good]);
    expect(errors).toHaveLength(1);
  });

  it('leaves accounts/rankAnchors/targets undefined when the envelope has none of those sections (v1 files)', () => {
    const { accounts, rankAnchors, targets } = parseVantageImport(envelope(), { now });
    expect(accounts).toBeUndefined();
    expect(rankAnchors).toBeUndefined();
    expect(targets).toBeUndefined();
  });
});

describe('buildImportEnvelope', () => {
  const game = (matchId: string): GameRecord => ({
    matchId, timestamp: 1000, account: 'Main', role: 'damage', map: 'Ilios',
    result: 'Win', gameType: 'Competitive', heroes: ['Tracer'],
    mental: { tilt: true }, review: { at: 1000, grades: { t1: 'hit' }, flags: {} },
  });
  const target: AuthoredTarget = { id: 't1', name: 'Hold cover', mode: 'self', rule: 'r', createdAt: 100, isActive: true };
  const rankAnchors: RankAnchorMap = {
    'Main::damage': { tier: 'Gold', division: 3, progressPct: 40, setAt: 500 },
    'Main::tank': { tier: 'Silver', division: 5, progressPct: 10, setAt: 600 },
  };
  const data: BackupData = {
    games: [game('a')],
    accounts: [{ battleTag: 'You#1234', label: 'Main' }],
    rankAnchors,
    targets: [target],
  };

  it('stamps vantageImport: 2 and the given exportedAt', () => {
    const env = buildImportEnvelope(data, { now: () => 12345 });
    expect(env.vantageImport).toBe(2);
    expect(env.exportedAt).toBe(12345);
  });

  it('carries games, accounts and targets through unchanged', () => {
    const env = buildImportEnvelope(data, { now });
    expect(env.games).toEqual(data.games);
    expect(env.accounts).toEqual(data.accounts);
    expect(env.targets).toEqual(data.targets);
  });

  it('splits the RankAnchorMap into one entry per (account, role), account/role parsed from the key', () => {
    const env = buildImportEnvelope(data, { now });
    expect(env.rankAnchors).toEqual([
      { account: 'Main', role: 'damage', tier: 'Gold', division: 3, progressPct: 40, setAt: 500 },
      { account: 'Main', role: 'tank', tier: 'Silver', division: 5, progressPct: 10, setAt: 600 },
    ]);
  });

  it('round-trips through parseVantageImport: games (with review/mental), accounts, rankAnchors and targets all come back', () => {
    const env = buildImportEnvelope(data, { now });
    const parsed = parseVantageImport(env, { now });
    expect(parsed.errors).toEqual([]);
    // Every import stamps source: 'manual' regardless of the file's own
    // (unread) source field — the same v1 behavior this round-trip inherits.
    expect(parsed.games).toEqual(data.games.map((g) => ({ ...g, source: 'manual' })));
    expect(parsed.accounts).toEqual(data.accounts);
    expect(parsed.targets).toEqual(data.targets);
    expect(parsed.rankAnchors).toEqual(env.rankAnchors);
  });
});
