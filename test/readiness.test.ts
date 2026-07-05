import { describe, it, expect } from 'vitest';
import {
  computeReadiness,
  safeReadiness,
  DEFAULT_READINESS,
  normalizeReadiness,
} from '../src/core/readiness';
import type { GameRecord, MatchMental } from '../src/core/analytics';
import type { Result, Role } from '../src/core/model';

// ---- fixtures -------------------------------------------------------------
// Timestamps are built from LOCAL Date values in a DST-stable window (June–July
// 2026), so day-ordinal math is consistent regardless of the CI runner's zone.

const MIN = 60_000;
let seq = 0;

function ts(dayIndex: number, hour = 14, min = 0): number {
  return new Date(2026, 5, 1 + dayIndex, hour, min, 0).getTime();
}

function game(p: Partial<GameRecord> & { timestamp: number }): GameRecord {
  return {
    matchId: p.matchId ?? `m${seq++}`,
    account: 'Main',
    role: 'damage' as Role,
    map: 'Ilios',
    result: 'Win' as Result,
    gameType: 'Competitive',
    heroes: ['Tracer'],
    ...p,
  };
}

const TILT: MatchMental = { tilt: true };
const CALM: MatchMental = { tilt: false, positiveComms: true };

interface SpanOpts {
  perDay: number;
  result?: Result;
  mental?: MatchMental;
  gapMin?: number;
  hour?: number;
  account?: string;
}

/** Build `perDay` games on each day in [fromDay, toDay]. */
function span(fromDay: number, toDay: number, opts: SpanOpts): GameRecord[] {
  const { perDay, result = 'Win', mental, gapMin = 12, hour = 14, account = 'Main' } = opts;
  const out: GameRecord[] = [];
  for (let d = fromDay; d <= toDay; d += 1) {
    for (let i = 0; i < perDay; i += 1) {
      out.push(game({ timestamp: ts(d, hour) + i * gapMin * MIN, result, mental, account }));
    }
  }
  return out;
}

// ---- settings -------------------------------------------------------------

describe('DEFAULT_READINESS', () => {
  it('is enabled with the launch toast off', () => {
    expect(DEFAULT_READINESS).toEqual({ enabled: true, launchToast: false });
  });
});

describe('normalizeReadiness', () => {
  it('fills missing/garbage fields from defaults', () => {
    expect(normalizeReadiness(undefined)).toEqual(DEFAULT_READINESS);
    expect(normalizeReadiness({ enabled: false })).toEqual({ enabled: false, launchToast: false });
    expect(normalizeReadiness({ launchToast: true } as never)).toEqual({ enabled: true, launchToast: true });
    expect(normalizeReadiness({ enabled: 'yes' } as never)).toEqual(DEFAULT_READINESS);
  });
});

// ---- totality (no throw on degenerate input) ------------------------------

describe('totality', () => {
  const now = ts(35, 20);
  it('empty history → insufficient-data, score null, no throw', () => {
    const r = computeReadiness([], now);
    expect(r.band).toBe('insufficient-data');
    expect(r.score).toBeNull();
  });
  it('single game does not throw', () => {
    expect(() => computeReadiness([game({ timestamp: ts(30) })], now)).not.toThrow();
  });
  it('all draws does not produce NaN', () => {
    const r = computeReadiness(span(15, 34, { perDay: 2, result: 'Draw', mental: TILT }), now);
    expect(Number.isNaN(r.score as number)).toBe(false);
    expect(typeof r.band).toBe('string');
  });
  it('all games in one day does not throw', () => {
    expect(() => computeReadiness(span(30, 30, { perDay: 20 }), now)).not.toThrow();
  });
  it('future-stamped games are ignored', () => {
    const r = computeReadiness([game({ timestamp: ts(99) }), game({ timestamp: ts(30) })], now);
    expect(r.band).toBe('insufficient-data'); // only the one valid game remains
  });
  it('duplicate timestamps do not throw', () => {
    const dup = Array.from({ length: 20 }, () => game({ timestamp: ts(30, 14) }));
    expect(() => computeReadiness(dup, now)).not.toThrow();
  });
  it('safeReadiness never throws', () => {
    expect(() => safeReadiness([], now)).not.toThrow();
  });
});

// ---- AC A: insufficient data ---------------------------------------------

describe('AC A — insufficient data', () => {
  const now = ts(35, 20);
  it('too few days → insufficient-data', () => {
    const r = computeReadiness(span(31, 35, { perDay: 2 }), now); // span 4
    expect(r.band).toBe('insufficient-data');
    expect(r.score).toBeNull();
    expect(r.recommendation).toBe('none');
  });
  it('enough games but too short a span → insufficient-data', () => {
    const r = computeReadiness(span(34, 35, { perDay: 10 }), now); // 20 games, span 1
    expect(r.band).toBe('insufficient-data');
  });
  it('too few games → insufficient-data', () => {
    const r = computeReadiness(span(20, 33, { perDay: 1 }), now); // 14 games over 14 days
    expect(r.band).toBe('insufficient-data');
  });
});

// ---- stale recency gate ---------------------------------------------------

describe('stale history', () => {
  it('a healthy history that ended long ago → fresh, score null, low confidence', () => {
    const games = span(0, 18, { perDay: 3, mental: CALM }); // ends day 18
    const r = computeReadiness(games, ts(40, 20)); // 22 rest days
    expect(r.band).toBe('fresh');
    expect(r.score).toBeNull();
    expect(r.confidence).toBe('low');
  });
});

// ---- AC B: moderate consistent play stays green --------------------------

describe('AC B — moderate consistent daily play is green', () => {
  it('long streak, flat load, low tilt, played today → green, no rec (no false amber)', () => {
    const games = span(5, 35, { perDay: 3, mental: CALM });
    const r = computeReadiness(games, ts(35, 20));
    expect(['fresh', 'steady']).toContain(r.band);
    expect(r.recommendation).toBe('none');
    // consecutiveDays alone (>=4) must NOT force amber:
    expect(r.load.consecutiveDays).toBeGreaterThanOrEqual(4);
  });
});

// ---- AC C: rising load → amber -------------------------------------------

describe('AC C — elevated load is amber', () => {
  it('acute games/day spike, low tilt → loaded / ease-up', () => {
    const games = [
      ...span(5, 32, { perDay: 2, mental: CALM }),
      ...span(33, 35, { perDay: 8, mental: CALM }),
    ];
    const r = computeReadiness(games, ts(35, 20));
    expect(r.band).toBe('loaded');
    expect(r.recommendation).toBe('ease-up');
  });

  it('flat games/day but a >2.5h session → loaded (session-length gate)', () => {
    const base = span(5, 34, { perDay: 3, mental: CALM, gapMin: 12 });
    // day 35: 3 games spaced 80 min apart → one ~172-min session
    const longDay = span(35, 35, { perDay: 3, mental: CALM, gapMin: 80 });
    const r = computeReadiness([...base, ...longDay], ts(35, 22));
    expect(r.band).toBe('loaded');
  });
});

// ---- AC D: in-the-hole (red) ---------------------------------------------

describe('AC D — in-the-hole', () => {
  it('flat high volume (ratio≈1) + tilt → red via the absolute-load arm', () => {
    const games = span(18, 35, { perDay: 10, mental: TILT });
    const r = computeReadiness(games, ts(35, 20));
    expect(r.band).toBe('in-the-hole');
    expect(r.recommendation).toBe('rest-1-2-days');
    expect(r.signals.length).toBeGreaterThan(0);
    // proves it is not acceleration-driven:
    expect(r.load.ratio).toBeLessThan(1.3);
  });

  it('acute spike + tilt → red via the ratio arm', () => {
    const games = [
      ...span(10, 30, { perDay: 2, mental: CALM }),
      ...span(31, 35, { perDay: 8, mental: TILT }),
    ];
    const r = computeReadiness(games, ts(35, 20));
    expect(r.band).toBe('in-the-hole');
  });
});

// ---- AC E: outcomes never trigger red ------------------------------------

describe('AC E — a losing streak alone is never red', () => {
  it('heavy losing streak, no elevated tilt → not red', () => {
    const games = [
      ...span(5, 33, { perDay: 3, mental: CALM }),
      ...span(34, 35, { perDay: 4, result: 'Loss', mental: CALM }),
    ];
    const r = computeReadiness(games, ts(35, 20));
    expect(r.band).not.toBe('in-the-hole');
  });
});

// ---- AC F: recovery -------------------------------------------------------

describe('AC F — recovery after rest', () => {
  const redHistory = span(18, 35, { perDay: 10, mental: TILT });
  it('red history + 1 rest day → recovering, rec cleared', () => {
    const r = computeReadiness(redHistory, ts(36, 20));
    expect(r.band).toBe('recovering');
    expect(r.recommendation).toBe('none');
  });
  it('red history + 2 rest days → fresh', () => {
    const r = computeReadiness(redHistory, ts(37, 20));
    expect(r.band).toBe('fresh');
  });
});

// ---- AC G: ordinary variance ---------------------------------------------

describe('AC G — ordinary variance stays out of the red', () => {
  it('4-game losing streak inside moderate, rested play → green/amber, never red', () => {
    const games = [
      ...span(5, 33, { perDay: 3, mental: CALM }), // rest on day 34
      ...span(35, 35, { perDay: 4, result: 'Loss', mental: CALM }),
    ];
    const r = computeReadiness(games, ts(35, 20));
    expect(r.band).not.toBe('in-the-hole');
  });
});

// ---- AC H: cross-account aggregation + dedupe ----------------------------

describe('AC H — person-level aggregation', () => {
  it('two accounts on the same days aggregate into one load', () => {
    const main = span(18, 35, { perDay: 5, mental: TILT, account: 'Main' });
    const alt = span(18, 35, { perDay: 5, mental: TILT, account: 'Alt', hour: 16 });
    const r = computeReadiness([...main, ...alt], ts(35, 20));
    expect(r.load.acutePerDay).toBeGreaterThanOrEqual(9); // ~10/day, not 5
    expect(r.band).toBe('in-the-hole');
  });
  it('duplicate matchIds are counted once', () => {
    const games = span(18, 35, { perDay: 5, mental: TILT });
    const withDupes = [...games, ...games.map((g) => ({ ...g }))]; // same matchIds
    const single = computeReadiness(games, ts(35, 20));
    const doubled = computeReadiness(withDupes, ts(35, 20));
    expect(doubled.load.acutePerDay).toBe(single.load.acutePerDay);
  });
});

// ---- AC I: sparse mental --------------------------------------------------

describe('AC I — sparse mental coverage', () => {
  it('heavy load but low coverage → not red, low confidence, no crash', () => {
    // 10 games/day, but only 1 in 10 carries a mental flag (coverage 0.1)
    const games: GameRecord[] = [];
    for (let d = 18; d <= 35; d += 1) {
      for (let i = 0; i < 10; i += 1) {
        games.push(game({ timestamp: ts(d, 14) + i * 12 * MIN, mental: i === 0 ? TILT : undefined }));
      }
    }
    const r = computeReadiness(games, ts(35, 20));
    expect(r.band).not.toBe('in-the-hole');
    expect(r.confidence).toBe('low');
  });
});

// ---- AC J: no srDelta -----------------------------------------------------

describe('AC J — works without SR', () => {
  it('history with no srDelta produces a valid band', () => {
    const r = computeReadiness(span(5, 35, { perDay: 3, mental: CALM }), ts(35, 20));
    expect(['fresh', 'steady', 'loaded', 'in-the-hole', 'recovering', 'insufficient-data']).toContain(r.band);
  });
  it('srDelta present is tolerated', () => {
    const games = span(5, 35, { perDay: 3, mental: CALM }).map((g) => ({ ...g, srDelta: -12 }));
    expect(() => computeReadiness(games, ts(35, 20))).not.toThrow();
  });
});

// ---- thin-history EWMA artifact ------------------------------------------

describe('thin-history ratio artifact', () => {
  it('a spike over a sparse baseline neutralises the ratio (no geometric false alarm)', () => {
    const games = [
      game({ timestamp: ts(16) }), // one old game → span 19
      ...span(34, 35, { perDay: 7, mental: CALM }),
    ];
    const r = computeReadiness(games, ts(35, 20));
    expect(r.load.ratio).toBe(1); // chronic support < 7 active days → ratio untrusted
    expect(r.band).not.toBe('in-the-hole');
  });
});

// ---- boundaries -----------------------------------------------------------

describe('boundaries', () => {
  it('span exactly 14 with >=15 games is sufficient', () => {
    const r = computeReadiness(span(21, 35, { perDay: 2, mental: CALM }), ts(35, 20)); // span 14, 30 games
    expect(r.band).not.toBe('insufficient-data');
  });

  it('exactly 5 consecutive heavy days + tilt → red; 4 → not red', () => {
    const baseline = span(5, 20, { perDay: 2, mental: CALM }); // history for span; rest days 21-25
    const five = computeReadiness([...baseline, ...span(26, 30, { perDay: 10, mental: TILT })], ts(30, 20));
    expect(five.band).toBe('in-the-hole');
    const four = computeReadiness([...baseline, ...span(27, 30, { perDay: 10, mental: TILT })], ts(30, 20));
    expect(four.band).not.toBe('in-the-hole');
  });
});

// ---- outcome-signal recency ----------------------------------------------

describe('loss-streak signal recency', () => {
  it('an old loss streak hidden behind newer draws is not surfaced as a recent streak', () => {
    // Losses on days 26–28, then only draws on days 29–35. streak() strips draws,
    // so an unwindowed streak would still report the old losses as "recent".
    const games = [
      ...span(5, 25, { perDay: 2, mental: CALM }),
      ...span(26, 28, { perDay: 4, result: 'Loss', mental: CALM }),
      ...span(29, 35, { perDay: 2, result: 'Draw', mental: CALM }),
    ];
    const r = computeReadiness(games, ts(35, 20));
    expect(r.signals.some((s) => s.key === 'loss-streak')).toBe(false);
  });

  it('a genuinely recent loss streak is still surfaced', () => {
    const games = [
      ...span(5, 31, { perDay: 2, mental: CALM }),
      ...span(34, 35, { perDay: 4, result: 'Loss', mental: CALM }),
    ];
    const r = computeReadiness(games, ts(35, 20));
    expect(r.signals.some((s) => s.key === 'loss-streak')).toBe(true);
  });
});

// ---- trend ----------------------------------------------------------------

describe('trend', () => {
  it('returns trendDays points with in-range or null scores', () => {
    const r = computeReadiness(span(5, 35, { perDay: 3, mental: CALM }), ts(35, 20));
    expect(r.trend).toHaveLength(21);
    for (const p of r.trend) {
      expect(p.score === null || (p.score >= 0 && p.score <= 100)).toBe(true);
    }
  });
});
