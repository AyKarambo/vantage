import { describe, it, expect } from 'vitest';
import { parseVantageImport } from '../src/core/importEnvelope';

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
