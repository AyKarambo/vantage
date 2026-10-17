import { describe, it, expect } from 'vitest';
import { formOf, formPenalty, formBonus } from '../src/core/readiness/performance';
import { READINESS_TUNING as T } from '../src/core/readiness';

/*
 * Calibration harness for the readiness form detector (AC7, issue #307).
 *
 * The objective-performance decline detector smooths each counted game's z score
 * (vs the player's own baseline) into a "form" and fires when the form leaves the
 * dead-band. Its constants (formLambda, formDeadband, evidenceMinGames) were chosen
 * so that, by simulation:
 *   - normal play (mean 0) fires in <= 5% of weeks at EVERY volume, 8 to 60 games —
 *     the old detector (peak of a one-sided CUSUM over the week) fired in ~27% of
 *     normal weeks at 30 games and ~49% at 60, so heavy players got false declines;
 *   - a real slump (mean -0.5) is still caught in >= 65% of weeks of 15+ games;
 *   - the bonus side is the exact mirror (good form is not handed out for noise, but
 *     a genuinely good stretch is visible).
 *
 * Everything runs on a seeded PRNG, so the measured rates are identical on every
 * run: a failure here means a constant (or the EWMA) changed, never bad luck.
 */

/** Per-game spread of the winsorized z score, measured on a real 529-game history. */
const SD = 0.7;
/** Simulated weeks per (scenario, volume) cell — enough that a ~3% rate is known to ~0.25%. */
const WEEKS = 5000;
/** Comparable games per week that the volume sweeps cover. */
const NORMAL_VOLUMES = [8, 15, 30, 45, 60] as const;
const SIGNAL_VOLUMES = [15, 30, 45, 60] as const;

/** mulberry32: a tiny, well-mixed 32-bit seeded PRNG returning floats in [0, 1). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard-normal generator over a uniform PRNG (Box-Muller; the second variate is discarded to keep it simple). */
function normal(rng: () => number): number {
  const u1 = 1 - rng(); // (0, 1] so log() never sees 0
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

const winsor = (z: number): number => Math.max(-T.zWinsor, Math.min(T.zWinsor, z));

/** One week of n per-game scores ~ Normal(mean, sd), winsorized to ±zWinsor as the engine does per metric. */
function weekScores(n: number, mean: number, sd: number, rng: () => number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(winsor(mean + sd * normal(rng)));
  return out;
}

/** The engine's gate: enough counted games AND a form past the dead-band on the penalty side. */
const fires = (scores: readonly number[]): boolean =>
  scores.length >= T.evidenceMinGames && formPenalty(formOf(scores)) > 0;

/** The mirror: enough counted games AND a form past the dead-band on the bonus side. */
const rewards = (scores: readonly number[]): boolean =>
  scores.length >= T.evidenceMinGames && formBonus(formOf(scores)) > 0;

/** Fire and reward rates over WEEKS seeded weeks of n games at the given true mean. */
function rates(n: number, mean: number): { fire: number; reward: number } {
  // A distinct, fixed seed per cell keeps every cell reproducible and independent of the others.
  const rng = mulberry32(0x5eed0000 + n * 131 + Math.round((mean + 1) * 1000));
  let fired = 0;
  let rewarded = 0;
  for (let w = 0; w < WEEKS; w++) {
    const scores = weekScores(n, mean, SD, rng);
    if (fires(scores)) fired++;
    if (rewards(scores)) rewarded++;
  }
  return { fire: fired / WEEKS, reward: rewarded / WEEKS };
}

describe('form detector calibration (AC7, #307) — seeded synthetic weeks, sd 0.7', () => {
  it('the generator is deterministic and standard-normal-ish', () => {
    const a = weekScores(50, 0, SD, mulberry32(42));
    const b = weekScores(50, 0, SD, mulberry32(42));
    expect(a).toEqual(b);
    const rng = mulberry32(7);
    const xs = Array.from({ length: 20000 }, () => normal(rng));
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length);
    expect(Math.abs(mean)).toBeLessThan(0.03);
    expect(Math.abs(sd - 1)).toBeLessThan(0.03);
  });

  it('winsorizes every simulated game to ±zWinsor', () => {
    const scores = weekScores(2000, 0, 5, mulberry32(1)); // an absurd spread to force clipping
    expect(Math.max(...scores)).toBeLessThanOrEqual(T.zWinsor);
    expect(Math.min(...scores)).toBeGreaterThanOrEqual(-T.zWinsor);
  });

  describe('normal play (mean 0)', () => {
    const measured = new Map(NORMAL_VOLUMES.map((n) => [n, rates(n, 0)]));

    it.each(NORMAL_VOLUMES)('fires in at most 5 percent of weeks at n=%i games', (n) => {
      const rate = measured.get(n)!.fire;
      expect(rate, `n=${n} fire rate=${rate}`).toBeLessThanOrEqual(0.05);
    });

    it('the false-alarm rate does NOT grow materially with volume (the old window-peak detector did)', () => {
      const low = measured.get(15)!.fire;
      const high = measured.get(60)!.fire;
      expect(high, `n=60 rate=${high} vs n=15 rate=${low}`).toBeLessThanOrEqual(low + 0.02);
    });

    it.each(NORMAL_VOLUMES)('hands out a bonus in at most 5 percent of weeks at n=%i games (symmetric)', (n) => {
      const rate = measured.get(n)!.reward;
      expect(rate, `n=${n} bonus rate=${rate}`).toBeLessThanOrEqual(0.05);
    });
  });

  describe('slump (mean -0.5)', () => {
    it.each(SIGNAL_VOLUMES)('is caught in at least 65 percent of weeks at n=%i games', (n) => {
      const rate = rates(n, -0.5).fire;
      expect(rate, `n=${n} slump detection rate=${rate}`).toBeGreaterThanOrEqual(0.65);
    });
  });

  describe('good stretch (mean +0.5)', () => {
    it.each(SIGNAL_VOLUMES)('is rewarded in at least 65 percent of weeks at n=%i games (the mirror)', (n) => {
      const rate = rates(n, 0.5).reward;
      expect(rate, `n=${n} good-stretch bonus rate=${rate}`).toBeGreaterThanOrEqual(0.65);
    });
  });

  describe('the evidence gate', () => {
    it('fewer than evidenceMinGames games never fire, even when every one is at -zWinsor', () => {
      for (let n = 0; n < T.evidenceMinGames; n++) {
        const scores = new Array<number>(n).fill(-T.zWinsor);
        expect(fires(scores), `n=${n}`).toBe(false);
      }
    });

    it('fewer than evidenceMinGames games never earn a bonus, even when every one is at +zWinsor', () => {
      for (let n = 0; n < T.evidenceMinGames; n++) {
        const scores = new Array<number>(n).fill(T.zWinsor);
        expect(rewards(scores), `n=${n}`).toBe(false);
      }
    });

    it('the gate is the only thing holding the short run back: the same -zWinsor games past the minimum do fire', () => {
      const scores = new Array<number>(T.evidenceMinGames).fill(-T.zWinsor);
      expect(fires(scores)).toBe(true);
    });
  });
});
