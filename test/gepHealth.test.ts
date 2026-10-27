import { describe, it, expect } from 'vitest';
import {
  INITIAL_GEP_TRACK, SILENT_AFTER_ATTACH_MS, STALE_AFTER_MS, decideSilentNotification, gepHealth, gepSignalOf,
  reduceGepSignal,
  type GepHealthTrack, type GepSignal,
} from '../src/core/gepHealth';
import type { GepMessage } from '../src/core/model';

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

describe('gepHealth — silent feed (game plugin never loaded)', () => {
  it('attached with zero events stays connected under the threshold, flips silent at it', () => {
    const t = fold([['attached', 100]]);
    expect(gepHealth(t, 100 + SILENT_AFTER_ATTACH_MS - 1)).toBe('connected');
    expect(gepHealth(t, 100 + SILENT_AFTER_ATTACH_MS)).toBe('silent');
  });

  it('one event ever means the feed is alive — a quiet menu never reads silent', () => {
    const t = fold([['attached', 0], ['event', 6_000]]);
    expect(gepHealth(t, SILENT_AFTER_ATTACH_MS * 10)).toBe('connected');
  });

  it('the first event recovers silent → connected immediately', () => {
    let t = fold([['attached', 0]]);
    expect(gepHealth(t, SILENT_AFTER_ATTACH_MS)).toBe('silent');
    t = reduceGepSignal(t, { kind: 'event' }, SILENT_AFTER_ATTACH_MS + 1);
    expect(gepHealth(t, SILENT_AFTER_ATTACH_MS + 2)).toBe('connected');
  });

  it('a re-attach (new game launch) restarts the clock', () => {
    const t = fold([['attached', 0], ['detached', SILENT_AFTER_ATTACH_MS * 2], ['attached', SILENT_AFTER_ATTACH_MS * 3]]);
    expect(gepHealth(t, SILENT_AFTER_ATTACH_MS * 3 + 1000)).toBe('connected');
  });

  it('pins the threshold at 2 minutes', () => {
    expect(SILENT_AFTER_ATTACH_MS).toBe(120_000);
  });
});

describe('decideSilentNotification', () => {
  it('notifies once on the transition into silent', () => {
    const n = decideSilentNotification('connected', 'silent');
    expect(n?.title).toMatch(/no game data/);
    expect(n?.body).toMatch(/Restart Vantage/);
    expect(decideSilentNotification(null, 'silent')).not.toBeNull();
  });

  it('stays quiet while silent, on recovery, and for every other state', () => {
    expect(decideSilentNotification('silent', 'silent')).toBeNull();
    expect(decideSilentNotification('silent', 'connected')).toBeNull();
    expect(decideSilentNotification('live', 'stale')).toBeNull();
    expect(decideSilentNotification('no-game', 'connected')).toBeNull();
  });
});

describe('gepSignalOf', () => {
  const msg = (kind: 'info' | 'event', feature: string, key: string, value: unknown): GepMessage =>
    ({ kind, feature, key, value } as GepMessage);

  it('reads match_start and match_end as the match boundaries', () => {
    expect(gepSignalOf(msg('event', 'match_info', 'match_start', null))).toBe('match-start');
    expect(gepSignalOf(msg('event', 'match_info', 'match_end', null))).toBe('match-end');
  });

  it('reads game_state = match_in_progress as a start, for a match joined mid-way', () => {
    // The app restarted mid-match: no match_start will come, only the snapshot.
    expect(gepSignalOf(msg('info', 'game_info', 'game_state', 'match_in_progress'))).toBe('match-start');
    const t = [
      gepSignalOf(msg('info', 'game_info', 'game_state', 'match_in_progress')),
      gepSignalOf(msg('info', 'roster', 'roster_0', '{}')),
    ].reduce((acc, kind, i) => reduceGepSignal(acc, { kind }, 10 + i), reduceGepSignal(INITIAL_GEP_TRACK, { kind: 'attached' }, 0));
    expect(gepHealth(t, 20)).toBe('live');
  });

  it('treats other game states and ordinary messages as plain events', () => {
    expect(gepSignalOf(msg('info', 'game_info', 'game_state', 'loading_screen_start'))).toBe('event');
    expect(gepSignalOf(msg('info', 'game_info', 'game_state', 'match_ended'))).toBe('match-end');
    expect(gepSignalOf(msg('event', 'match_info', 'kill_feed', '{}'))).toBe('event');
  });
});
