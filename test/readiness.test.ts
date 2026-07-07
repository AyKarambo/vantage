import { describe, it, expect } from 'vitest';
import {
  computeReadiness,
  safeReadiness,
  DEFAULT_READINESS,
  normalizeReadiness,
} from '../src/core/readiness';
import { restEffectFor } from '../src/core/readiness/score';
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
  it('a healthy history that ended long ago → rusty, score null, low confidence', () => {
    const games = span(0, 18, { perDay: 3, mental: CALM }); // ends day 18
    const r = computeReadiness(games, ts(40, 20)); // 22 rest days
    expect(r.band).toBe('rusty');
    expect(r.score).toBeNull();
    expect(r.confidence).toBe('low');
    expect(r.recommendation).toBe('ramp-back-up');
    expect(r.signals.some((s) => s.key === 'rust-gap')).toBe(true);
  });
});

// ---- undertraining: rust after a layoff ------------------------------------

describe('undertraining — rust after a layoff', () => {
  const history = span(5, 28, { perDay: 3, mental: CALM }); // healthy daily play, ends day 28

  it('6 rest days → still fresh (a long weekend off is not rust)', () => {
    const r = computeReadiness(history, ts(34, 20));
    expect(r.band).toBe('fresh');
  });

  it('7 rest days → rusty with the ramp-back-up nudge', () => {
    const r = computeReadiness(history, ts(35, 20));
    expect(r.band).toBe('rusty');
    expect(r.recommendation).toBe('ramp-back-up');
    expect(r.signals.some((s) => s.key === 'rust-gap' && s.severity === 'watch')).toBe(true);
  });

  it('10+ rest days → the rust signal escalates to high', () => {
    const r = computeReadiness(history, ts(38, 20));
    expect(r.band).toBe('rusty');
    expect(r.signals.some((s) => s.key === 'rust-gap' && s.severity === 'high')).toBe(true);
  });

  it('a heavy (red) history also lands on rusty after a long layoff, not fresh', () => {
    const red = span(10, 28, { perDay: 10, mental: TILT });
    const r = computeReadiness(red, ts(36, 20)); // 8 rest days
    expect(r.band).toBe('rusty');
  });

  it('a rusty verdict does not surface stale load/tilt signals from before the layoff', () => {
    // 19 straight heavy tilted days would scream overtraining — but they ended
    // 8 days ago. "22 days in a row" under a Rusty verdict reads as its opposite.
    const red = span(10, 28, { perDay: 10, mental: TILT });
    const r = computeReadiness(red, ts(36, 20));
    const keys = r.signals.map((s) => s.key);
    expect(keys).toContain('rust-gap');
    for (const stale of ['consecutive-days', 'games-per-day', 'load-ratio', 'long-session', 'tilt', 'loss-streak']) {
      expect(keys).not.toContain(stale);
    }
  });

  it('score decays with a long layoff: 10 rest days scores below 2 rest days', () => {
    const rested = computeReadiness(history, ts(30, 20)); // 2 rest days (peak recovery)
    const rusty = computeReadiness(history, ts(38, 20)); // 10 rest days
    expect(rusty.score).not.toBeNull();
    expect(rested.score).not.toBeNull();
    expect(rusty.score!).toBeLessThan(rested.score!);
  });

  it('restEffectFor is continuous: peaks at +25 on day 3, decays monotonically, floors at the cap', () => {
    const curve = Array.from({ length: 13 }, (_, d) => restEffectFor(d));
    expect(curve[3]).toBe(25);
    expect(Math.max(...curve)).toBe(25);
    for (let d = 4; d < curve.length; d += 1) expect(curve[d]).toBeLessThanOrEqual(curve[d - 1]);
    const steps = curve.slice(1).map((v, i) => Math.abs(v - curve[i]));
    expect(Math.max(...steps)).toBeLessThanOrEqual(12); // no hidden cliff bigger than the decay rate
    expect(restEffectFor(60)).toBe(-35); // rustPenaltyCap floor (retuned for the 75-anchor composite)
  });

  it('stale pre-layoff penalties fade with rest: a heavy grinder never scores below the rust floor', () => {
    // 10 tilted games/day carries heavy frozen penalties; after a week-plus
    // layoff those must have faded — rested-but-dull floors at baseScore −
    // rustPenaltyCap (75 − 35 = 40), never "wrecked".
    const red = span(10, 28, { perDay: 10, mental: TILT });
    for (const restDays of [7, 8, 10, 13]) {
      const r = computeReadiness(red, ts(28 + restDays, 20));
      expect(r.band).toBe('rusty');
      expect(r.score!).toBeGreaterThanOrEqual(40);
    }
  });
});

// ---- undertraining: low weekly frequency -----------------------------------

describe('undertraining — low play frequency', () => {
  it('a weekends-only player gets the consistency nudge while staying green', () => {
    // Two active days per week (Sat/Sun pattern) over five weeks, playing "today".
    const games: GameRecord[] = [];
    for (const d of [0, 1, 7, 8, 14, 15, 21, 22, 28, 29]) {
      games.push(...span(d, d, { perDay: 4, mental: CALM }));
    }
    const r = computeReadiness(games, ts(29, 20));
    expect(['fresh', 'steady']).toContain(r.band);
    expect(r.signals.some((s) => s.key === 'low-frequency')).toBe(true);
    expect(r.load.activeDaysPerWeek).toBeLessThan(3);
  });

  it('a daily player gets no consistency nudge', () => {
    const r = computeReadiness(span(5, 35, { perDay: 3, mental: CALM }), ts(35, 20));
    expect(r.signals.some((s) => s.key === 'low-frequency')).toBe(false);
  });

  it('a short (15-day) daily history is not misread as low-frequency', () => {
    // Only 15 observable days: dividing by the full 21-day window would rate
    // this 5-days-a-week rhythm (11 active days) at ~3.7/week instead of ~5.1 —
    // understating a new account by ~30%. Rate over the observed span instead.
    const games: GameRecord[] = [];
    for (let d = 21; d <= 35; d += 1) {
      if ((d - 21) % 7 < 5) games.push(...span(d, d, { perDay: 2, mental: CALM }));
    }
    const r = computeReadiness(games, ts(35, 20));
    expect(r.load.activeDaysPerWeek).toBeGreaterThanOrEqual(4.5);
    expect(r.signals.some((s) => s.key === 'low-frequency')).toBe(false);
  });

  it('rust and low-frequency never fire together (the gap owns the layoff case)', () => {
    const history = span(5, 28, { perDay: 3, mental: CALM });
    const r = computeReadiness(history, ts(36, 20)); // 8 rest days → rusty
    expect(r.signals.some((s) => s.key === 'rust-gap')).toBe(true);
    expect(r.signals.some((s) => s.key === 'low-frequency')).toBe(false);
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

  it('flat games/day but a >2.5h session → long-session signal (a single long session is a watch, not amber)', () => {
    // MIGRATED for the composite model: one ≥2.5h session against an otherwise
    // healthy rhythm costs longSessionPen (8) — a visible signal, not an amber
    // verdict on its own. (Amber needs the score at/below amberCut.)
    const base = span(5, 34, { perDay: 3, mental: CALM, gapMin: 12 });
    // day 35: 3 games spaced 80 min apart → one ~172-min session
    const longDay = span(35, 35, { perDay: 3, mental: CALM, gapMin: 80 });
    const r = computeReadiness([...base, ...longDay], ts(35, 22));
    expect(['fresh', 'steady']).toContain(r.band);
    expect(r.signals.some((s) => s.key === 'long-session')).toBe(true);
    expect(r.score!).toBeLessThan(75); // the session does cost readiness
  });
});

// ---- stat fixtures (per-10 decline recipes) --------------------------------

interface StatOpts extends SpanOpts {
  hero?: string;
  damage?: number;
  deaths?: number;
  elims?: number;
  healing?: number;
  /** durationMinutes; default 10 so per-game totals read directly as per-10 rates. */
  duration?: number;
}

/** Like span(), but each game is single-hero with real perHero stats + duration. */
function statSpan(fromDay: number, toDay: number, o: StatOpts): GameRecord[] {
  const { hero = 'Tracer', damage = 8000, deaths = 5, elims = 20, healing = 0, duration = 10 } = o;
  return span(fromDay, toDay, o).map((g) => ({
    ...g,
    heroes: [hero],
    durationMinutes: duration,
    perHero: [{ hero, role: g.role, eliminations: elims, deaths, assists: 5, damage, healing, mitigation: 0 }],
  }));
}

// ---- AC D: in-the-hole (red) ---------------------------------------------

describe('AC D — in-the-hole', () => {
  it('heavy spike + losing + per-10 decline vs own baseline → red, decline named among the reasons', () => {
    const baseline = statSpan(5, 28, { perDay: 3, mental: CALM, result: 'Win' });
    const collapse = statSpan(29, 35, {
      perDay: 10, result: 'Loss', mental: CALM,
      damage: 5500, deaths: 8, elims: 13, // well below the baseline stats above
    });
    const r = computeReadiness([...baseline, ...collapse], ts(35, 20));
    expect(r.band).toBe('in-the-hole');
    expect(r.recommendation).toBe('rest-1-2-days');
    expect(r.signals.some((s) => s.key === 'perf-decline' && s.severity === 'high')).toBe(true);
    expect(r.driver).toBe('overload');
  });

  it('flat habitual grinder with a genuine stat collapse → red via the absolute-load arm', () => {
    // Volume is the player's own norm the whole way (ratio≈1, volPen 0) — only
    // the objective decline plus the ABSOLUTE corroboration arm reaches red.
    const baseline = statSpan(12, 28, { perDay: 10, mental: CALM, result: 'Win' });
    const collapse = statSpan(29, 35, {
      perDay: 10, result: 'Loss', mental: CALM,
      damage: 5500, deaths: 8, elims: 13,
    });
    const r = computeReadiness([...baseline, ...collapse], ts(35, 20));
    expect(r.band).toBe('in-the-hole');
    expect(r.load.ratio).toBeLessThan(1.3); // proves it is not acceleration-driven
  });

  it('acute spike + tilt → red via the ratio arm', () => {
    const games = [
      ...span(10, 30, { perDay: 2, mental: CALM }),
      ...span(31, 35, { perDay: 8, mental: TILT }),
    ];
    const r = computeReadiness(games, ts(35, 20));
    expect(r.band).toBe('in-the-hole');
  });

  it('MIGRATED: flat high volume + tilt alone (no objective decline) is no longer red', () => {
    // The superseded model went red on load+tilt; the composite needs the score
    // in the red range, which subjective input alone (≤15) cannot produce.
    const games = span(18, 35, { perDay: 10, mental: TILT });
    const r = computeReadiness(games, ts(35, 20));
    expect(r.band).not.toBe('in-the-hole');
    expect(r.signals.some((s) => s.key === 'tilt')).toBe(true);
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
    expect(r.load.acutePerDay).toBeGreaterThanOrEqual(9); // ~10/day, not 5 — fatigue is per-person
    // Stable habitual volume + tilt alone is no longer red under the composite:
    expect(r.band).not.toBe('in-the-hole');
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

  it('the trend plots the SAME composite the verdict uses (no second engine)', () => {
    const r = computeReadiness(span(5, 35, { perDay: 3, mental: CALM }), ts(35, 20));
    expect(r.trend[r.trend.length - 1].score).toBe(r.score);
  });
});

// ---- composite model (score-first rework) ----------------------------------

describe('composite — marathon session (the owner core scenario)', () => {
  // Alternate-day baseline keeps consecutiveDays at 1 → sustainedLoad is FALSE;
  // only the marathonSession arm can corroborate red.
  const altDays = (): GameRecord[] => {
    const out: GameRecord[] = [];
    for (let d = 5; d <= 33; d += 2) out.push(...statSpan(d, d, { perDay: 3, result: 'Win', mental: CALM }));
    return out;
  };

  it('one ≥2.5h, 12-game losing session with collapsed stats reaches in-the-hole same-day', () => {
    // day 35: 12 games spaced 14 min → session ≈ 164 min ≥ 150, ≥ marathonMinGames
    const marathon = statSpan(35, 35, {
      perDay: 12, gapMin: 14, result: 'Loss', mental: CALM,
      damage: 5500, deaths: 8, elims: 13,
    });
    const r = computeReadiness([...altDays(), ...marathon], ts(35, 23));
    expect(r.load.consecutiveDays).toBeLessThan(5); // proves sustainedLoad is not the corroborator
    expect(r.band).toBe('in-the-hole');
    expect(r.recommendation).toBe('rest-1-2-days');
  });

  it('the same marathon WITHOUT any objective decline stays out of the red', () => {
    const healthyMarathon = statSpan(35, 35, { perDay: 12, gapMin: 14, result: 'Win', mental: CALM });
    const r = computeReadiness([...altDays(), ...healthyMarathon], ts(35, 23));
    expect(r.band).not.toBe('in-the-hole');
  });
});

describe('composite — habitual high volume stays green', () => {
  it('a stable 10-games/day rhythm (ratio≈1) with healthy stats reads green, not amber', () => {
    const r = computeReadiness(statSpan(12, 35, { perDay: 10, result: 'Win', mental: CALM }), ts(35, 20));
    expect(['fresh', 'steady']).toContain(r.band);
    expect(r.score!).toBeGreaterThanOrEqual(65);
    expect(r.load.ratio).toBeLessThan(1.3);
  });
});

describe('composite — dominant driver', () => {
  it('a grinding state and a layoff state read as different drivers and bands', () => {
    const grind = computeReadiness(
      [...span(10, 30, { perDay: 2, mental: CALM }), ...span(31, 35, { perDay: 8, mental: CALM })],
      ts(35, 20),
    );
    const layoff = computeReadiness(span(5, 26, { perDay: 3, mental: CALM }), ts(35, 20)); // 9 rest days
    expect(grind.driver).toBe('overload');
    expect(layoff.driver).toBe('rust');
    expect(grind.band).toBe('loaded');
    expect(layoff.band).toBe('rusty');
  });
});

describe('composite — layoff then catch-up binge (no whiplash)', () => {
  it('two normal-volume days after a 13-day layoff do not read as in-the-hole', () => {
    const games = [...span(5, 18, { perDay: 3, mental: CALM }), ...span(32, 35, { perDay: 6, mental: CALM })];
    const r = computeReadiness(games, ts(35, 20));
    expect(r.band).not.toBe('in-the-hole');
    expect(r.score!).toBeGreaterThanOrEqual(45);
  });
});

describe('composite — subjective hard cap', () => {
  it('maxed adverse subjective input alone moves the score ≤ 15 points and never reaches red', () => {
    // Healthy stable play; every game tilted + rated far below the player own average.
    const base = statSpan(5, 28, { perDay: 3, result: 'Win', mental: CALM }).map((g) => ({ ...g, performance: 80 }));
    const acute = statSpan(29, 35, { perDay: 3, result: 'Win', mental: TILT }).map((g) => ({ ...g, performance: 10 }));
    const r = computeReadiness([...base, ...acute], ts(35, 20));
    expect(r.score!).toBeGreaterThanOrEqual(60); // 75 − subjCap(15)
    expect(r.band).not.toBe('in-the-hole');
    expect(r.subscores.subjective.delta).toBeGreaterThanOrEqual(-15);
  });
});

describe('composite — losing streak alone (winrate gates MET) is bounded and never red', () => {
  it('flat volume, 20+ decided acute games of heavy losses → penalty ≤ cap, band ≤ amber', () => {
    const games = [
      ...span(5, 31, { perDay: 3, mental: CALM, result: 'Win' }),
      ...span(32, 35, { perDay: 3, mental: CALM, result: 'Loss' }), // 12 losses; acute decided ≈ 21
    ];
    const r = computeReadiness(games, ts(35, 20));
    expect(r.band).not.toBe('in-the-hole');
    expect(r.subscores.performance.delta).toBeGreaterThanOrEqual(-15); // the named outcome cap
    expect(r.score!).toBeGreaterThanOrEqual(60);
  });
});

describe('composite — subscore bounds hold across scenarios', () => {
  const scenarios: Array<[string, GameRecord[], number]> = [
    ['healthy daily', span(5, 35, { perDay: 3, mental: CALM }), ts(35, 20)],
    ['heavy tilted grind', span(18, 35, { perDay: 10, mental: TILT }), ts(35, 20)],
    ['collapse', [...statSpan(5, 28, { perDay: 3 }), ...statSpan(29, 35, { perDay: 10, result: 'Loss', damage: 100, deaths: 20, elims: 1 })], ts(35, 20)],
    ['rusty', span(5, 26, { perDay: 3, mental: CALM }), ts(35, 20)],
    ['thin chronic binge', [game({ timestamp: ts(16) }), ...span(34, 35, { perDay: 7 })], ts(35, 20)],
  ];
  it('every family delta stays within its documented bounds', () => {
    for (const [, games, now] of scenarios) {
      const r = computeReadiness(games, now);
      expect(r.subscores.load.delta).toBeGreaterThanOrEqual(-40);
      expect(r.subscores.load.delta).toBeLessThanOrEqual(25);
      expect(r.subscores.performance.delta).toBeGreaterThanOrEqual(-45);
      expect(r.subscores.performance.delta).toBeLessThanOrEqual(8);
      expect(r.subscores.subjective.delta).toBeGreaterThanOrEqual(-15);
      expect(r.subscores.subjective.delta).toBeLessThanOrEqual(8);
    }
  });
});

describe('composite — confidence rework', () => {
  it('a GEP-rich history with ZERO mental logs and no slider reaches high confidence', () => {
    const r = computeReadiness(statSpan(5, 35, { perDay: 3, result: 'Win' }), ts(35, 20));
    expect(r.confidence).toBe('high');
  });
  it('a manual-only history (no stats) with mental coverage lands at medium, never high', () => {
    const r = computeReadiness(span(5, 35, { perDay: 3, mental: CALM }), ts(35, 20));
    expect(r.confidence).toBe('medium');
  });
  it('a heavily mixed acute window is capped below high and surfaces the mixed-accounts note', () => {
    const main = statSpan(5, 35, { perDay: 2, account: 'Main' });
    const smurf = statSpan(5, 35, { perDay: 2, account: 'Smurf', hour: 18 });
    const r = computeReadiness([...main, ...smurf], ts(35, 20));
    expect(r.confidence).not.toBe('high');
    expect(r.signals.some((s) => s.key === 'mixed-accounts')).toBe(true);
    const single = computeReadiness(statSpan(5, 35, { perDay: 4 }), ts(35, 20));
    expect(single.confidence).toBe('high'); // the single-account twin does reach high
  });
});
