import { describe, it, expect } from 'vitest';
import {
  DEFAULT_ROUNDS,
  PLAYED_TIME_ESTIMATE,
  ROUND_SETUP_SECONDS,
  heroPlayedMinutes,
  heroCredits,
  heroTimeShares,
  overlapMinutes,
  playWindowsOf,
  playedMinutesOf,
  playedTimeOf,
  roundCountOf,
  setupMinutes,
  windowMinutes,
} from '../src/core/playedTime';
import type { GameRecord, HeroStat } from '../src/core/analytics';

const MIN = 60_000;

const hero = (p: Partial<HeroStat> & { hero: string }): HeroStat => ({
  eliminations: 10, deaths: 5, assists: 2, damage: 5000, healing: 0, mitigation: 0, ...p,
});

/** A GEP-looking record (no `manual` prefix, no explicit source) on a Control map. */
const game = (p: Partial<GameRecord> = {}): GameRecord => ({
  matchId: 'abc-123',
  timestamp: 1_000,
  account: 'Main',
  role: 'damage',
  map: 'Ilios',
  result: 'Win',
  gameType: 'Competitive',
  heroes: ['Tracer'],
  ...p,
});

describe('playWindowsOf / setup locks', () => {
  it('removes the per-mode setup lock from the start of each round (first vs later)', () => {
    const rounds = [{ startedAt: 0, endedAt: 10 * MIN }, { startedAt: 11 * MIN, endedAt: 20 * MIN }];
    const escort = playWindowsOf(rounds, 'Escort');
    expect(escort[0]).toEqual({ startedAt: ROUND_SETUP_SECONDS.Escort.first * 1000, endedAt: 10 * MIN });
    expect(escort[1]).toEqual({ startedAt: 11 * MIN + ROUND_SETUP_SECONDS.Escort.later * 1000, endedAt: 20 * MIN });
    const control = playWindowsOf(rounds, 'Control');
    expect(control[0]).toEqual({ startedAt: 0, endedAt: 10 * MIN }); // doors open at round start
    expect(control[1].startedAt).toBe(11 * MIN + 15_000);
  });

  it('drops a round shorter than its lock instead of producing a negative window', () => {
    expect(playWindowsOf([{ startedAt: 0, endedAt: 30_000 }], 'Hybrid')).toEqual([]);
  });

  it('setupMinutes accepts fractional round counts for estimates', () => {
    expect(setupMinutes('Control', 2.5)).toBeCloseTo((0 + 1.5 * 15) / 60, 6);
    expect(setupMinutes('Escort', 2)).toBeCloseTo((45 + 70) / 60, 6);
    expect(setupMinutes('Push', 1)).toBe(0);
    expect(setupMinutes('Escort', 0)).toBe(0);
  });

  it('windowMinutes sums the windows', () => {
    expect(windowMinutes([{ startedAt: 0, endedAt: 5 * MIN }, { startedAt: 6 * MIN, endedAt: 8 * MIN }])).toBe(7);
  });
});

describe('overlapMinutes', () => {
  const windows = [{ startedAt: 10 * MIN, endedAt: 20 * MIN }, { startedAt: 21 * MIN, endedAt: 30 * MIN }];

  it('clips a segment to the windows it touches', () => {
    expect(overlapMinutes(0, 15 * MIN, windows)).toBe(5); // pre-round part dropped
    expect(overlapMinutes(15 * MIN, 25 * MIN, windows)).toBe(9); // gap between rounds dropped
    expect(overlapMinutes(25 * MIN, 40 * MIN, windows)).toBe(5); // post-match tail dropped
  });

  it('is zero for a segment entirely outside every window or of non-positive length', () => {
    expect(overlapMinutes(0, 9 * MIN, windows)).toBe(0);
    expect(overlapMinutes(12 * MIN, 12 * MIN, windows)).toBe(0);
    expect(overlapMinutes(12 * MIN, 11 * MIN, windows)).toBe(0);
  });

  it('treats a still-open window as extending to the segment end', () => {
    expect(overlapMinutes(5 * MIN, 12 * MIN, [{ startedAt: 10 * MIN }])).toBe(2);
  });
});

describe('roundCountOf', () => {
  it('prefers recorded rounds, then a Control score, then the mode default', () => {
    expect(roundCountOf({ rounds: [{ startedAt: 0, endedAt: 1 }, { startedAt: 2, endedAt: 3 }] }, 'Escort')).toBe(2);
    expect(roundCountOf({ finalScore: '2–1' }, 'Control')).toBe(3);
    expect(roundCountOf({ finalScore: '2-0' }, 'Control')).toBe(2);
    expect(roundCountOf({ finalScore: '3–2' }, 'Escort')).toBe(DEFAULT_ROUNDS.Escort); // payload points, not rounds
    expect(roundCountOf({ finalScore: '5–4' }, 'Control')).toBe(DEFAULT_ROUNDS.Control); // not a plausible round tally
    expect(roundCountOf({}, 'Push')).toBe(1);
  });
});

describe('playedTimeOf', () => {
  it('MEASURED: a recorded playedMinutes wins outright', () => {
    const p = playedTimeOf(game({ playedMinutes: 9.4, durationMinutes: 11 }));
    expect(p).toEqual({ minutes: 9.4, baseMinutes: 9.4, source: 'measured' });
  });

  it('ESTIMATED: a legacy GEP capture loses the hero select, the scoreboard and the mode setup locks', () => {
    // 12-minute Control best-of-three by default (2.5 rounds → 1.5 later-round overlays).
    const p = playedTimeOf(game({ durationMinutes: 12 }))!;
    const outside = (PLAYED_TIME_ESTIMATE.preRoundSeconds + PLAYED_TIME_ESTIMATE.postMatchSeconds) / 60;
    expect(p.source).toBe('estimated');
    expect(p.baseMinutes).toBe(12);
    expect(p.minutes).toBeCloseTo(12 - outside - setupMinutes('Control', 2.5), 6);
  });

  it('ESTIMATED: measures from the wall clock, not the hero-minute sum', () => {
    // The recorded hero minutes can already exclude the hero select (a dropped
    // spawn-only first segment was anchored at match start), so subtracting it
    // from their sum would deduct it twice. The wall clock never has that.
    const p = playedTimeOf(game({
      map: 'Junkertown', // Escort, 2 competitive rounds by default
      durationMinutes: 12,
      perHero: [hero({ hero: 'Tracer', minutes: 7.3 }), hero({ hero: 'Genji', minutes: 4.9 })],
    }))!;
    expect(p.baseMinutes).toBe(12);
    expect(p.minutes).toBeCloseTo(12 - 68 / 60 - setupMinutes('Escort', 2), 6);
  });

  it('ESTIMATED: a capture with no wall clock keeps what it saw, deducting nothing', () => {
    // Vantage started mid-match: no match_start, so no duration was ever
    // written and the hero segments cover only the watched part — the phases
    // outside them were never in the record to subtract.
    const p = playedTimeOf(game({
      map: 'Junkertown',
      perHero: [hero({ hero: 'Tracer', minutes: 4 }), hero({ hero: 'Genji', minutes: 2.5 })],
    }))!;
    expect(p).toEqual({ minutes: 6.5, baseMinutes: 6.5, source: 'estimated' });
    // Nothing timed and no duration ⇒ nothing to divide by.
    expect(playedTimeOf(game({ perHero: [hero({ hero: 'Tracer' })] }))).toBeNull();
  });

  it('ESTIMATED: honours a Control round tally in the score', () => {
    const two = playedTimeOf(game({ durationMinutes: 12, finalScore: '2–0' }))!;
    const three = playedTimeOf(game({ durationMinutes: 12, finalScore: '2–1' }))!;
    expect(two.minutes).toBeGreaterThan(three.minutes);
    expect(two.minutes - three.minutes).toBeCloseTo(15 / 60, 6);
  });

  it('ESTIMATED: never drops below the floor on a very short match', () => {
    const p = playedTimeOf(game({ map: 'Junkertown', durationMinutes: 2 }))!;
    expect(p.minutes).toBe(Math.max(PLAYED_TIME_ESTIMATE.minPlayedMinutes, 2 * PLAYED_TIME_ESTIMATE.minPlayedFraction));
  });

  it('REPORTED: hand-logged durations are taken as typed', () => {
    expect(playedTimeOf(game({ matchId: 'manual-1', durationMinutes: 12 }))).toEqual({ minutes: 12, baseMinutes: 12, source: 'reported' });
    expect(playedTimeOf(game({ source: 'manual', durationMinutes: 8 }))).toEqual({ minutes: 8, baseMinutes: 8, source: 'reported' });
  });

  it('returns null when nothing usable is recorded', () => {
    expect(playedTimeOf(game())).toBeNull();
    expect(playedTimeOf(game({ durationMinutes: 0 }))).toBeNull();
    expect(playedTimeOf(game({ matchId: 'manual-2' }))).toBeNull();
    expect(playedMinutesOf(game())).toBeNull();
  });

  it('accepts a custom map-mode resolver (the user-editable catalog)', () => {
    const asEscort = playedTimeOf(game({ map: 'Somewhere New', durationMinutes: 12 }), () => 'Escort')!;
    const asPush = playedTimeOf(game({ map: 'Somewhere New', durationMinutes: 12 }), () => 'Push')!;
    expect(asPush.minutes - asEscort.minutes).toBeCloseTo(setupMinutes('Escort', 2), 6);
  });
});

describe('heroPlayedMinutes', () => {
  const measured = { minutes: 9, baseMinutes: 9, source: 'measured' as const };

  it('shares out the played total, so the parts sum to it', () => {
    expect(heroPlayedMinutes(4 / 9, measured)).toBeCloseTo(4, 9);
    expect(heroPlayedMinutes(5 / 9, measured)).toBeCloseTo(5, 9);
    const shares = [0.5, 0.3, 0.2];
    const total = shares.reduce((m, s) => m + (heroPlayedMinutes(s, measured) ?? 0), 0);
    expect(total).toBeCloseTo(measured.minutes, 9);
  });

  it('gives a hero credited none of the game none of the time either', () => {
    expect(heroPlayedMinutes(0, measured)).toBe(0);
  });

  it('lands legacy wall-clock minutes on the played basis via the share', () => {
    const estimated = { minutes: 10, baseMinutes: 12, source: 'estimated' as const };
    expect(heroPlayedMinutes(6 / 12, estimated)).toBe(5); // half the match ⇒ half the played time
  });

  it('is null without a played time', () => {
    expect(heroPlayedMinutes(0.5, null)).toBeNull();
  });
});

describe('heroTimeShares', () => {
  it('splits by real minutes when every row has them', () => {
    const shares = heroTimeShares({ heroes: ['Tracer', 'Genji'], perHero: [hero({ hero: 'Tracer', minutes: 6 }), hero({ hero: 'Genji', minutes: 2 })] });
    expect(shares.get('Tracer')).toBeCloseTo(0.75, 9);
    expect(shares.get('Genji')).toBeCloseTo(0.25, 9);
  });

  it('gives a hero with no played time no credit, rather than equal-splitting the match', () => {
    // A swap that lived entirely inside a setup phase clips to zero played
    // minutes and keeps no `minutes`, but survives as a row when a stat moved.
    const shares = heroTimeShares({ heroes: ['Tracer', 'Genji'], perHero: [hero({ hero: 'Tracer', minutes: 6 }), hero({ hero: 'Genji' })] });
    expect(shares.get('Tracer')).toBe(1);
    expect(shares.get('Genji')).toBe(0);
  });

  it('merges repeated heroes before splitting', () => {
    const swapped = heroTimeShares({ heroes: ['Tracer', 'Genji'], perHero: [hero({ hero: 'Tracer', minutes: 3 }), hero({ hero: 'Genji', minutes: 2 }), hero({ hero: 'Tracer', minutes: 3 })] });
    expect(swapped.get('Tracer')).toBeCloseTo(0.75, 9);
    expect(swapped.size).toBe(2);
  });

  it('credits the hand-corrected hero list when the player has overruled the feed', () => {
    // The match editor patches `heroes`, stamps factsEditedAt and leaves
    // `perHero` as the feed sent it; the correction has to win, or the edit
    // changes nothing on the Heroes screen.
    const rows = [hero({ hero: 'Tracer', minutes: 6 }), hero({ hero: 'Genji', minutes: 2 })];
    expect([...heroTimeShares({ heroes: ['Sojourn'], perHero: rows, factsEditedAt: 1 })]).toEqual([['Sojourn', 1]]);
    // Without that marker the recorded rows are the truth, whatever heroes[] says.
    expect(heroTimeShares({ heroes: ['Sojourn'], perHero: rows }).get('Tracer')).toBeCloseTo(0.75, 9);
    // Same heroes in a different order is not a correction.
    expect(heroTimeShares({ heroes: ['Genji', 'Tracer'], perHero: rows, factsEditedAt: 1 }).get('Tracer')).toBeCloseTo(0.75, 9);
  });

  it('an overruled match pools its totals over the chosen heroes, stats and credit together', () => {
    const credits = heroCredits({
      heroes: ['Sojourn', 'Ashe'],
      role: 'damage',
      factsEditedAt: 1,
      perHero: [hero({ hero: 'Tracer', minutes: 6, eliminations: 12, damage: 9000 }), hero({ hero: 'Genji', minutes: 2, eliminations: 4, damage: 3000 })],
    });
    expect(credits.map((c) => c.hero)).toEqual(['Sojourn', 'Ashe']);
    expect(credits.every((c) => c.share === 0.5)).toBe(true);
    expect(credits[0].stats.eliminations).toBe(8); // (12 + 4) / 2
    expect(credits[0].stats.damage).toBe(6000);
  });

  it('uses the heroes list for manual logs and is empty with no heroes', () => {
    const shares = heroTimeShares({ heroes: ['Ana', 'Kiriko'] });
    expect(shares.get('Ana')).toBe(0.5);
    expect(heroTimeShares({ heroes: [] }).size).toBe(0);
  });
});
