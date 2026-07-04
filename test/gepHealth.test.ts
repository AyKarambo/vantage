import { describe, it, expect } from 'vitest';
import {
  INITIAL_GEP_TRACK, STALE_AFTER_MS, gepHealth, reduceGepSignal,
  type GepHealthTrack, type GepSignal,
} from '../src/core/gepHealth';

/** Fold a list of (signal, at) through the reducer, as the monitor would. */
function fold(signals: Array<[GepSignal['kind'], number]>): GepHealthTrack {
  return signals.reduce(
    (t, [kind, at]) => reduceGepSignal(t, { kind }, at),
    INITIAL_GEP_TRACK,
  );
}

describe('reduceGepSignal', () => {
  it('attach starts a fresh session; detach resets it', () => {
    const attached = fold([['attached', 100]]);
    expect(attached.attachedAt).toBe(100);
    expect(attached.eventsThisSession).toBe(0);

    const detached = reduceGepSignal(attached, { kind: 'detached' }, 200);
    expect(detached).toEqual(INITIAL_GEP_TRACK);
  });

  it('every event kind bumps lastEventAt and the counter', () => {
    const t = fold([['attached', 0], ['match-start', 10], ['event', 20], ['match-end', 30]]);
    expect(t.lastEventAt).toBe(30);
    expect(t.eventsThisSession).toBe(3);
  });

  it('match boundaries toggle matchInProgress', () => {
    const inMatch = fold([['attached', 0], ['match-start', 10]]);
    expect(inMatch.matchInProgress).toBe(true);
    const after = reduceGepSignal(inMatch, { kind: 'match-end' }, 20);
    expect(after.matchInProgress).toBe(false);
  });

  it('re-attach after detach starts clean (no stale counters carried over)', () => {
    const t = fold([['attached', 0], ['event', 5], ['detached', 10], ['attached', 20]]);
    expect(t).toEqual({ ...INITIAL_GEP_TRACK, attachedAt: 20 });
  });
});

describe('gepHealth derivation', () => {
  it('not attached → no-game', () => {
    expect(gepHealth(INITIAL_GEP_TRACK, 0)).toBe('no-game');
  });

  it('attached with no match in progress → connected (never live in menus)', () => {
    const t = fold([['attached', 0], ['event', 5]]);
    expect(gepHealth(t, 10)).toBe('connected');
  });

  it('match start flips to live immediately (the start is itself an event)', () => {
    const t = fold([['attached', 0], ['match-start', 10]]);
    expect(gepHealth(t, 11)).toBe('live');
  });

  it('stays live under the threshold, flips stale at exactly 60s of silence', () => {
    const t = fold([['attached', 0], ['match-start', 10]]);
    expect(gepHealth(t, 10 + STALE_AFTER_MS - 1)).toBe('live');
    expect(gepHealth(t, 10 + STALE_AFTER_MS)).toBe('stale');
  });

  it('one event recovers stale → live immediately', () => {
    let t = fold([['attached', 0], ['match-start', 10]]);
    const staleAt = 10 + STALE_AFTER_MS + 5000;
    expect(gepHealth(t, staleAt)).toBe('stale');
    t = reduceGepSignal(t, { kind: 'event' }, staleAt);
    expect(gepHealth(t, staleAt + 1)).toBe('live');
  });

  it('match end decays to connected — no false warning between matches', () => {
    const t = fold([['attached', 0], ['match-start', 10], ['match-end', 20]]);
    expect(gepHealth(t, 20 + STALE_AFTER_MS * 2)).toBe('connected');
  });

  it('detach mid-match → no-game', () => {
    const t = fold([['attached', 0], ['match-start', 10], ['detached', 20]]);
    expect(gepHealth(t, 25)).toBe('no-game');
  });

  it('pins the spec threshold at 60 seconds', () => {
    expect(STALE_AFTER_MS).toBe(60_000);
  });
});
