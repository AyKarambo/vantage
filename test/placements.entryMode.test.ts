import { describe, it, expect } from 'vitest';
import { srEntryMode, isStillCounting, type EntryModeRun } from '../src/core/placements';

const run = (p: Partial<EntryModeRun> = {}): EntryModeRun => ({
  counted: 4, target: 10, completed: false, countedMatchIds: ['m0', 'm1', 'm2', 'm3'], ...p,
});

const tenCounted = Array.from({ length: 10 }, (_, i) => `m${i}`);
const awaiting = (p: Partial<EntryModeRun> = {}): EntryModeRun =>
  run({ counted: 10, completed: false, countedMatchIds: tenCounted, ...p });

describe('placements — srEntryMode', () => {
  it('a new match on a still-counting run gets the placement picker', () => {
    expect(srEntryMode(run())).toBe('placement');
  });

  it('a new match on a run that already counted its ten gets plain ±% entry', () => {
    // The regression test for #184's follow-up: Overwatch revealed the rank at
    // match ten and went back to showing ±%, so an eleventh match must be able
    // to record one. It used to be handed the picker and written with no ±% at
    // all, which suppression cannot mask back into existence.
    expect(srEntryMode(awaiting())).toBe('delta-only');
  });

  it('an already-logged placement match keeps the picker after the run hits ten', () => {
    // Per-MATCH, not per-run: match four is one of the counted ten forever, so
    // its prediction stays editable and it never acquires a fabricated ±%.
    expect(srEntryMode(awaiting(), 'm3')).toBe('placement');
  });

  it('the eleventh match is an ordinary game, even while the run is open', () => {
    expect(srEntryMode(awaiting(), 'm10')).toBe('delta-only');
  });

  it('a match the run was backdated over is not a placement match', () => {
    // Same assertion, different cause — a match on the track that falls outside
    // the counted set. Previously it was shown the picker purely because the
    // track had an open run.
    expect(srEntryMode(run(), 'older-match')).toBe('delta-only');
  });

  it('never offers the set-current aid while a run is open, new match or old', () => {
    // 'full' is the only mode carrying "set current rank". That aid measures an
    // entered rank against the track's LIVE anchor, which while a run is open is
    // still the pre-run one — so entering the revealed rank would store the
    // whole season-reset gap as one match's ±%.
    for (const r of [run(), awaiting()]) {
      expect(srEntryMode(r)).not.toBe('full');
      expect(srEntryMode(r, 'm0')).not.toBe('full');
      expect(srEntryMode(r, 'anything')).not.toBe('full');
    }
  });

  it('no run at all gets the full SR block', () => {
    expect(srEntryMode(undefined)).toBe('full');
    expect(srEntryMode(undefined, 'm0')).toBe('full');
  });

  it('a completed run gets the full SR block — the track has a settled rank again', () => {
    const done = awaiting({ completed: true });
    expect(srEntryMode(done)).toBe('full');
    expect(srEntryMode(done, 'm0')).toBe('full');
  });
});

describe('placements — isStillCounting', () => {
  it('true only while an open run has room for another counted match', () => {
    expect(isStillCounting(run())).toBe(true);
    expect(isStillCounting(awaiting())).toBe(false);
    expect(isStillCounting(awaiting({ completed: true }))).toBe(false);
    expect(isStillCounting(undefined)).toBe(false);
  });
});
