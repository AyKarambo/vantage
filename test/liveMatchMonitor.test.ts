import { describe, it, expect, vi } from 'vitest';
import { createLiveMatchMonitor, PUBLISH_INTERVAL_MS, toPayload } from '../src/main/liveMatchMonitor';
import { INITIAL_LIVE_MATCH, reduceLiveMatch } from '../src/core/liveMatch';
import type { GepMessage } from '../src/core/model';
import type { LiveMatchPayload } from '../src/shared/contract';

const info = (feature: string, key: string, value: unknown): GepMessage =>
  ({ kind: 'info', feature, key, value } as GepMessage);
const event = (key: string, value: unknown): GepMessage =>
  ({ kind: 'event', feature: 'match_info', key, value } as GepMessage);
const roster = (slot: number, p: Record<string, unknown>): GepMessage =>
  info('roster', `roster_${slot}`, JSON.stringify(p));

function harness(opts: { killFeed?: boolean } = {}) {
  let clock = 0;
  const published: LiveMatchPayload[] = [];
  const monitor = createLiveMatchMonitor({
    publish: (p) => published.push(p),
    killFeedEnabled: () => opts.killFeed ?? true,
    now: () => clock,
  });
  return { monitor, published, tick: (ms: number) => { clock += ms; }, at: (ms: number) => { clock = ms; } };
}

describe('liveMatchMonitor — publishing', () => {
  it('publishes a phase change immediately, without waiting for the throttle', () => {
    const { monitor, published } = harness();
    monitor.message(event('match_start', null));
    expect(published).toHaveLength(1);
    expect(published[0].live).toBe(true);
  });

  it('throttles mid-match roster ticks to one publish per window', () => {
    const { monitor, published, tick } = harness();
    monitor.message(event('match_start', null)); // publishes, and opens the window
    published.length = 0;

    // Everything inside the window the match_start publish opened is coalesced.
    monitor.message(roster(0, { battle_tag: 'A#1', kills: 1 }));
    monitor.message(roster(0, { battle_tag: 'A#1', kills: 2 }));
    monitor.message(roster(0, { battle_tag: 'A#1', kills: 3 }));
    expect(published).toHaveLength(0);

    // Once the window passes, the next tick publishes — carrying the LATEST
    // state, not a backlog: the fold is a running state, not a queue.
    tick(PUBLISH_INTERVAL_MS);
    monitor.message(roster(0, { battle_tag: 'A#1', kills: 4 }));
    expect(published).toHaveLength(1);
    expect(published[0].roster[0]).toMatchObject({ eliminations: 4 });

    // And the window closes again behind it.
    monitor.message(roster(0, { battle_tag: 'A#1', kills: 5 }));
    expect(published).toHaveLength(1);
  });

  it('never publishes when the fold changed nothing', () => {
    const { monitor, published, tick } = harness();
    monitor.message(event('match_start', null));
    published.length = 0;
    tick(PUBLISH_INTERVAL_MS * 5);
    monitor.message(roster(0, { battle_tag: 'A#1', kills: 1 }));
    published.length = 0;
    tick(PUBLISH_INTERVAL_MS * 5);
    monitor.message(roster(0, { battle_tag: 'A#1', kills: 1 })); // identical
    expect(published).toHaveLength(0);
  });

  it('stays silent while idle, however much the feed chatters', () => {
    const { monitor, published, tick } = harness();
    for (let i = 0; i < 10; i++) {
      tick(PUBLISH_INTERVAL_MS);
      monitor.message(info('game_info', 'game_state', 'ended'));
      monitor.message(roster(0, { battle_tag: 'A#1' }));
    }
    expect(published).toHaveLength(0);
  });

  it('publishes the end of a match at once', () => {
    const { monitor, published } = harness();
    monitor.message(event('match_start', null));
    published.length = 0;
    monitor.message(event('match_end', null));
    expect(published).toHaveLength(1);
    expect(published[0].live).toBe(false);
  });
});

describe('liveMatchMonitor — detach', () => {
  it('ends a live match when GEP detaches, and says so immediately', () => {
    // The blocker this exists for: a crash or alt-F4 emits no match_end, so
    // without this the board would show a stale scoreboard as CURRENT for the
    // rest of the session while the status bar correctly reads "no match".
    const { monitor, published } = harness();
    monitor.message(event('match_start', null));
    monitor.message(roster(0, { battle_tag: 'A#1', is_local: true }));
    published.length = 0;

    monitor.setAttached(false);

    expect(published).toHaveLength(1);
    expect(published[0].live).toBe(false);
    expect(published[0].roster).toEqual([]);
  });

  it('does nothing when detaching while already idle', () => {
    const { monitor, published } = harness();
    monitor.setAttached(false);
    expect(published).toHaveLength(0);
  });

  it('attaching alone publishes nothing — it is not news', () => {
    const { monitor, published } = harness();
    monitor.setAttached(true);
    expect(published).toHaveLength(0);
  });
});

describe('liveMatchMonitor — payload', () => {
  const withRoster = (): ReturnType<typeof harness> => {
    const h = harness();
    h.monitor.message(event('match_start', null));
    h.monitor.message(roster(0, { battle_tag: 'Me#1', hero_name: 'ANA', team: 0, kills: 3, healed: 9000 }));
    h.monitor.message(roster(1, { battle_tag: 'Foe#2', hero_name: 'GENJI', team: 1, kills: 5 }));
    h.monitor.message(info('game_info', 'battle_tag', 'Me#1'));
    return h;
  };

  it('renders scoreboard rows with the local player resolved and roles derived', () => {
    const { monitor } = withRoster();
    const p = monitor.snapshot();
    const me = p.roster.find((r) => r.name === 'Me#1');
    expect(me).toMatchObject({ isLocal: true, hero: 'Ana', role: 'support', eliminations: 3, healing: 9000 });
    expect(p.roster.find((r) => r.name === 'Foe#2')).toMatchObject({ isLocal: false, role: 'damage' });
    expect(p.teamsKnown).toBe(true);
  });

  it('reports teamsKnown false when the feed never gave team numbers', () => {
    const { monitor } = harness();
    monitor.message(event('match_start', null));
    monitor.message(roster(0, { battle_tag: 'Me#1', is_local: true }));
    monitor.message(roster(1, { battle_tag: 'Foe#2' }));
    expect(monitor.snapshot().teamsKnown).toBe(false);
  });

  it('marks the elimination tally unknown until the feed says which side attacked', () => {
    // 0–0 would read as "nobody has died yet"; unknown is the honest answer.
    const { monitor } = harness();
    monitor.message(event('match_start', null));
    expect(monitor.snapshot().kills.known).toBe(false);

    monitor.message(event('kill_feed', JSON.stringify({ attacker: 'Me', victim: 'Foe', is_attacker_teammate: true })));
    const p = monitor.snapshot();
    expect(p.kills).toMatchObject({ yours: 1, theirs: 0, known: true });
  });

  it('withholds EVERYTHING kill-derived when the user turned the feed off', () => {
    // Not just the per-kill strip: the elimination count is only a sum of the
    // same events, so leaving it on screen would defeat the point of switching
    // the feed off. Withheld at the source, so it never crosses the bridge.
    const { monitor } = harness({ killFeed: false });
    monitor.message(event('match_start', null));
    monitor.message(event('kill_feed', JSON.stringify({ attacker: 'Me', victim: 'Foe', is_attacker_teammate: true })));
    const p = monitor.snapshot();
    expect(p.feed).toEqual([]);
    expect(p.kills).toEqual({ yours: 0, theirs: 0, known: false });
  });

  it('still tracks the tally internally, so switching back on is not blank', () => {
    // The fold keeps counting regardless; only the projection withholds. Turning
    // the feed back on mid-match therefore shows the real count, not a restart
    // from zero.
    let enabled = false;
    const monitor = createLiveMatchMonitor({
      publish: vi.fn(), killFeedEnabled: () => enabled, now: () => 0,
    });
    monitor.message(event('match_start', null));
    monitor.message(event('kill_feed', JSON.stringify({ attacker: 'Me', victim: 'Foe', is_attacker_teammate: true })));
    expect(monitor.snapshot().feed).toEqual([]);
    enabled = true;
    expect(monitor.snapshot().feed).toHaveLength(1);
    expect(monitor.snapshot().kills).toMatchObject({ yours: 1, known: true });
  });
});

describe('toPayload', () => {
  it('is idle and empty for the initial state', () => {
    expect(toPayload(INITIAL_LIVE_MATCH, true)).toMatchObject({
      live: false, roster: [], feed: [], teamsKnown: false,
    });
  });

  it('carries endedAt through so the idle screen can say a match just finished', () => {
    let s = reduceLiveMatch(INITIAL_LIVE_MATCH, event('match_start', null), 1000);
    s = reduceLiveMatch(s, event('match_end', null), 4000);
    expect(toPayload(s, true)).toMatchObject({ live: false, endedAt: 4000 });
  });
});
