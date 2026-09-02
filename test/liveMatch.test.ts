import { describe, it, expect } from 'vitest';
import {
  INITIAL_LIVE_MATCH, LIVE_FEED_CAP, reduceLiveMatch, liveMatchDetached,
  liveRoster, liveOpponentNames, liveTeamTotals, localTeam, type LiveMatchState,
} from '../src/core/liveMatch';
import type { GepMessage } from '../src/core/model';

/**
 * The live-match reducer. Everything here is about the states the feed puts us
 * in that are NOT "a clean match from start to end" — those are the ones that
 * leave a stale scoreboard on screen presented as current.
 */

const info = (feature: string, key: string, value: unknown): GepMessage =>
  ({ kind: 'info', feature, key, value } as GepMessage);
const event = (key: string, value: unknown): GepMessage =>
  ({ kind: 'event', feature: 'match_info', key, value } as GepMessage);

const start = (): GepMessage => event('match_start', null);
const roster = (slot: number, p: Record<string, unknown>): GepMessage =>
  info('roster', `roster_${slot}`, JSON.stringify(p));

const live = (t = 1000): LiveMatchState => reduceLiveMatch(INITIAL_LIVE_MATCH, start(), t);

describe('reduceLiveMatch — phase', () => {
  it('opens a fresh match on match_start, from any phase', () => {
    const s = live(500);
    expect(s.phase).toBe('live');
    expect(s.startedAt).toBe(500);
  });

  it('clears the previous match\'s roster and tally when a new one starts', () => {
    let s = live();
    s = reduceLiveMatch(s, roster(0, { battle_tag: 'Old#1', kills: 9 }), 1001);
    s = reduceLiveMatch(s, start(), 2000);
    expect(s.roster).toEqual({});
    expect(s.kills).toEqual({ yours: 0, theirs: 0 });
    expect(s.feed).toEqual([]);
  });

  it('IGNORES a match-end signal while idle, returning the very same state', () => {
    // isMatchEndMessage also matches a game_info.game_state of "ended", which
    // the feed emits with no match running (menus, quitting the game). Handling
    // it while idle would allocate a new object every time — publishing on each
    // throttle window and re-stamping endedAt, so the idle screen would claim a
    // match had just finished when none ever started.
    const ended = info('game_info', 'game_state', 'ended');
    expect(reduceLiveMatch(INITIAL_LIVE_MATCH, ended, 1)).toBe(INITIAL_LIVE_MATCH);
    expect(reduceLiveMatch(INITIAL_LIVE_MATCH, ended, 2)).toBe(INITIAL_LIVE_MATCH);
  });

  it('ignores ordinary messages while idle, by reference', () => {
    expect(reduceLiveMatch(INITIAL_LIVE_MATCH, roster(0, { battle_tag: 'X#1' }), 1)).toBe(INITIAL_LIVE_MATCH);
  });

  it('ends the match on match_end, stamping endedAt and dropping the board', () => {
    let s = live();
    s = reduceLiveMatch(s, roster(0, { battle_tag: 'A#1' }), 1001);
    s = reduceLiveMatch(s, event('match_end', null), 5000);
    expect(s.phase).toBe('idle');
    expect(s.endedAt).toBe(5000);
    expect(s.roster).toEqual({});
  });
});

describe('liveMatchDetached', () => {
  it('ends a live match when GEP detaches, since no match_end will ever arrive', () => {
    // A crash, an alt-F4, or the game closing mid-match emits no match_end. The
    // status indicator recovers on detach; without this the live board would
    // contradict it for the rest of the session.
    const s = liveMatchDetached(live(), 9000);
    expect(s.phase).toBe('idle');
    expect(s.endedAt).toBe(9000);
  });

  it('is a no-op while already idle, by reference', () => {
    expect(liveMatchDetached(INITIAL_LIVE_MATCH, 1)).toBe(INITIAL_LIVE_MATCH);
  });
});

describe('reduceLiveMatch — roster', () => {
  it('MERGES partial slot updates instead of replacing them', () => {
    // A tick can carry only what changed. Replacing would blank a support's
    // healing the moment a tick omitted it.
    let s = live();
    s = reduceLiveMatch(s, roster(0, { battle_tag: 'Ana#1', hero_name: 'ANA', healing: 4000, team: 0 }), 1001);
    s = reduceLiveMatch(s, roster(0, { kills: 3 }), 1002);
    expect(s.roster.roster_0).toMatchObject({ battleTag: 'Ana#1', healing: 4000, kills: 3, team: 0 });
  });

  it('drops the teardown blanks the feed sends just before match_end', () => {
    let s = live();
    s = reduceLiveMatch(s, roster(0, { battle_tag: 'Ana#1', hero_name: 'ANA' }), 1001);
    const rich = s.roster.roster_0;
    s = reduceLiveMatch(s, info('roster', 'roster_0', '{}'), 1002);
    s = reduceLiveMatch(s, roster(0, { hero_name: 'UNKNOWN' }), 1003);
    expect(s.roster.roster_0).toEqual(rich);
  });

  it('returns the same reference when a slot update changes nothing', () => {
    let s = live();
    s = reduceLiveMatch(s, roster(0, { battle_tag: 'Ana#1', kills: 1 }), 1001);
    expect(reduceLiveMatch(s, roster(0, { battle_tag: 'Ana#1', kills: 1 }), 1002)).toBe(s);
  });
});

describe('liveRoster — resolving who is local', () => {
  it('marks the local player even when the roster arrived BEFORE the battle_tag did', () => {
    // The failure this guards: rows stamped at write time are never
    // re-examined, so a feed that names the local player late leaves no row
    // marked local — and the whole with/vs split degrades to "unknown".
    let s = live();
    s = reduceLiveMatch(s, roster(0, { battle_tag: 'Me#1234', hero_name: 'ANA', team: 0 }), 1001);
    s = reduceLiveMatch(s, roster(1, { battle_tag: 'Mate#5', hero_name: 'GENJI', team: 0 }), 1002);
    s = reduceLiveMatch(s, roster(2, { battle_tag: 'Foe#9', hero_name: 'LUCIO', team: 1 }), 1003);
    // …only now does the feed say who we are.
    s = reduceLiveMatch(s, info('game_info', 'battle_tag', 'Me#1234'), 1004);

    const list = liveRoster(s);
    expect(list.find((p) => p.battleTag === 'Me#1234')?.isLocal).toBe(true);
    expect(list.find((p) => p.battleTag === 'Mate#5')?.isLocal).toBeFalsy();
    expect(localTeam(list)).toBe(0);
  });

  it('honours the feed\'s own is_local flag when no battle_tag ever arrives', () => {
    let s = live();
    s = reduceLiveMatch(s, roster(0, { battle_tag: 'Me#1234', is_local: true, team: 1 }), 1001);
    expect(localTeam(liveRoster(s))).toBe(1);
  });

  it('orders by roster slot, not insertion order', () => {
    let s = live();
    s = reduceLiveMatch(s, roster(3, { battle_tag: 'D#1' }), 1001);
    s = reduceLiveMatch(s, roster(1, { battle_tag: 'B#1' }), 1002);
    s = reduceLiveMatch(s, roster(10, { battle_tag: 'K#1' }), 1003);
    expect(liveRoster(s).map((p) => p.battleTag)).toEqual(['B#1', 'D#1', 'K#1']);
  });

  it('lists every identified non-local player once, for the known-players lookup', () => {
    let s = live();
    s = reduceLiveMatch(s, roster(0, { battle_tag: 'Me#1', is_local: true }), 1001);
    s = reduceLiveMatch(s, roster(1, { battle_tag: 'Mate#5' }), 1002);
    s = reduceLiveMatch(s, roster(2, { battle_tag: 'mate#5' }), 1003); // same identity, other slot
    s = reduceLiveMatch(s, roster(3, { hero_name: 'GENJI' }), 1004); // no identity at all
    expect(liveOpponentNames(liveRoster(s))).toEqual(['Mate#5']);
  });
});

describe('reduceLiveMatch — kill feed', () => {
  const kill = (over: Record<string, unknown> = {}) =>
    event('kill_feed', JSON.stringify({
      attacker: 'Me', victim: 'Foe', is_attacker_teammate: true,
      attacker_hero_name: 'GENJI', victim_hero_name: 'ANA', ...over,
    }));

  it('tallies eliminations by side', () => {
    let s = live();
    s = reduceLiveMatch(s, kill(), 1001);
    s = reduceLiveMatch(s, kill(), 1002);
    s = reduceLiveMatch(s, kill({ is_attacker_teammate: false }), 1003);
    expect(s.kills).toEqual({ yours: 2, theirs: 1 });
  });

  it('never counts a revive as an elimination', () => {
    let s = live();
    s = reduceLiveMatch(s, kill({ revived: 'Mate', revived_hero_name: 'ANA' }), 1001);
    expect(s.kills).toEqual({ yours: 0, theirs: 0 });
    expect(s.feed[0].revive).toBe(true);
  });

  it('records the entry but counts nothing when the feed omits the team relation', () => {
    // Guessing a side would be inventing data (guardrail #1).
    let s = live();
    s = reduceLiveMatch(s, kill({ is_attacker_teammate: undefined }), 1001);
    expect(s.kills).toEqual({ yours: 0, theirs: 0 });
    expect(s.feed).toHaveLength(1);
  });

  it('keeps only the most recent entries, newest first', () => {
    let s = live();
    for (let i = 0; i < LIVE_FEED_CAP + 4; i++) s = reduceLiveMatch(s, kill({ victim: `V${i}` }), 1000 + i);
    expect(s.feed).toHaveLength(LIVE_FEED_CAP);
    expect(s.feed[0].victim).toBe(`V${LIVE_FEED_CAP + 3}`);
  });

  it('canonicalizes ALL-CAPS hero names the way the rest of the app stores them', () => {
    const s = reduceLiveMatch(live(), kill(), 1001);
    expect(s.feed[0]).toMatchObject({ attackerHero: 'Genji', victimHero: 'Ana' });
  });

  it('ignores a kill feed arriving while idle', () => {
    expect(reduceLiveMatch(INITIAL_LIVE_MATCH, kill(), 1)).toBe(INITIAL_LIVE_MATCH);
  });
});

describe('reduceLiveMatch — match facts', () => {
  it('resolves the map name and records the game type', () => {
    let s = live();
    s = reduceLiveMatch(s, info('match_info', 'map', '1645'), 1001);
    s = reduceLiveMatch(s, info('game_info', 'game_type', 'competitive'), 1002);
    // GEP sends a numeric map id; resolveMapId turns 1645 into the app's name.
    expect(s.mapName).toBe('Ilios');
    expect(s.gameType).toBe('competitive');
  });
});

describe('reduceLiveMatch — kill feed payload shapes', () => {
  // Overwolf documents the kill data as a JSON STRING nested in the event's
  // `name`. Package versions have delivered it bare, wrapped, and pre-parsed.
  const payload = {
    attacker: 'brandy', victim: 'SpectralSoul',
    is_attacker_teammate: false, is_victim_teammate: false,
    attacker_hero_name: 'GENJI', victim_hero_name: 'SOJOURN',
    supporter: '', revived: '',
  };

  it('reads the documented wrapper — a JSON string under `name`', () => {
    const msg = event('kill_feed', { name: JSON.stringify(payload) });
    const s = reduceLiveMatch(live(), msg, 1001);
    expect(s.kills).toEqual({ yours: 0, theirs: 1 });
    expect(s.feed[0]).toMatchObject({ attacker: 'brandy', victimHero: 'Sojourn' });
  });

  it('reads a bare JSON string', () => {
    const s = reduceLiveMatch(live(), event('kill_feed', JSON.stringify(payload)), 1001);
    expect(s.feed[0]).toMatchObject({ victim: 'SpectralSoul' });
  });

  it('reads an already-parsed object', () => {
    const s = reduceLiveMatch(live(), event('kill_feed', payload), 1001);
    expect(s.feed[0]).toMatchObject({ victim: 'SpectralSoul' });
  });

  it('drops an unreadable payload rather than guessing at it', () => {
    const s = live();
    expect(reduceLiveMatch(s, event('kill_feed', 'not json'), 1001)).toBe(s);
    expect(reduceLiveMatch(s, event('kill_feed', null), 1001)).toBe(s);
  });

  it('treats an EMPTY `revived` as a kill, not a revive', () => {
    // The documented example ships `"revived":""` on an ordinary kill — reading
    // presence rather than content would silently stop counting eliminations.
    const s = reduceLiveMatch(live(), event('kill_feed', JSON.stringify(payload)), 1001);
    expect(s.feed[0].revive).toBeUndefined();
    expect(s.kills.theirs).toBe(1);
  });
});

describe('liveTeamTotals', () => {
  const p = (over: Record<string, unknown>) => over as never;

  it('sums damage and healing per side', () => {
    const roster = [
      p({ isLocal: true, team: 0, damage: 2000, healing: 6000 }),
      p({ team: 0, damage: 3000, healing: 500 }),
      p({ team: 1, damage: 4000, healing: 100 }),
      p({ team: 1, damage: 1000, healing: 2000 }),
    ];
    expect(liveTeamTotals(roster)).toEqual({
      yours: { damage: 5000, healing: 6500 },
      theirs: { damage: 5000, healing: 2100 },
      known: true,
    });
  });

  it('treats a missing stat as zero rather than dropping the player', () => {
    const roster = [
      p({ isLocal: true, team: 0, damage: 1000 }),
      p({ team: 1, healing: 700 }),
    ];
    expect(liveTeamTotals(roster)).toMatchObject({
      yours: { damage: 1000, healing: 0 },
      theirs: { damage: 0, healing: 700 },
    });
  });

  it('is unknown when the feed never named the local player\'s team', () => {
    // With no "your side" the two numbers have nothing to compare against.
    const roster = [p({ damage: 1000, team: 0 }), p({ damage: 2000, team: 1 })];
    expect(liveTeamTotals(roster).known).toBe(false);
  });

  it('is unknown when only YOUR side was reported', () => {
    // One-sided totals invite exactly the "we're ahead" misreading this guards.
    const roster = [p({ isLocal: true, team: 0, damage: 1000 })];
    expect(liveTeamTotals(roster).known).toBe(false);
  });

  it('ignores players the feed gave no team for', () => {
    const roster = [
      p({ isLocal: true, team: 0, damage: 1000 }),
      p({ team: 1, damage: 500 }),
      p({ damage: 9999 }), // no team — belongs to neither total
    ];
    const t = liveTeamTotals(roster);
    expect(t.yours.damage).toBe(1000);
    expect(t.theirs.damage).toBe(500);
  });

  it('reads off the roster, so it stands with no kill feed at all', () => {
    // Damage and healing are TAB-screen numbers, not kill-derived — which is why
    // they survive the kill feed being switched off.
    let s = live();
    s = reduceLiveMatch(s, roster(0, { battle_tag: 'Me#1', is_local: true, team: 0, damage: 1200, healed: 3400 }), 1001);
    s = reduceLiveMatch(s, roster(1, { battle_tag: 'Foe#2', team: 1, damage: 800, healed: 100 }), 1002);
    expect(liveTeamTotals(liveRoster(s))).toEqual({
      yours: { damage: 1200, healing: 3400 },
      theirs: { damage: 800, healing: 100 },
      known: true,
    });
  });
});

describe('reduceLiveMatch — deployables are not eliminations', () => {
  /**
   * Overwatch reports destroying a turret or pylon as an ordinary kill event —
   * victim `Takigano`, victim hero `Illari Healing Pylon`. Counting those
   * inflates the elimination tally in every single match, and nobody died.
   */
  const destroy = (victimHero: string, over: Record<string, unknown> = {}) =>
    event('kill_feed', JSON.stringify({
      attacker: 'Kirito', victim: 'Takigano', is_attacker_teammate: true,
      attacker_hero_name: 'PHARAH', victim_hero_name: victimHero, ...over,
    }));

  it('does not count a destroyed Healing Pylon as an elimination', () => {
    const s = reduceLiveMatch(live(), destroy('Illari Healing Pylon'), 1001);
    expect(s.kills).toEqual({ yours: 0, theirs: 0 });
  });

  it('still records it in the feed, tagged with its owner and what it was', () => {
    // It did happen — it just isn't a kill. Hiding it would lose real information.
    const s = reduceLiveMatch(live(), destroy('Illari Healing Pylon'), 1001);
    expect(s.feed[0]).toMatchObject({
      attacker: 'Kirito', victim: 'Takigano',
      deployable: { hero: 'Illari', label: 'Healing Pylon' },
    });
  });

  it('still counts a kill on the HERO of the same name', () => {
    // The discriminator must not swallow Illari herself.
    const s = reduceLiveMatch(live(), destroy('ILLARI'), 1001);
    expect(s.kills).toEqual({ yours: 1, theirs: 0 });
    expect(s.feed[0].deployable).toBeUndefined();
  });

  it('handles other heroes\' deployables the same way, with no hard-coded list', () => {
    let s = live();
    s = reduceLiveMatch(s, destroy('Torbjörn Turret'), 1001);
    s = reduceLiveMatch(s, destroy('Symmetra Teleporter'), 1002);
    s = reduceLiveMatch(s, destroy('Wrecking Ball Minefield'), 1003);
    expect(s.kills).toEqual({ yours: 0, theirs: 0 });
    expect(s.feed.map((k) => k.deployable?.hero)).toEqual(['Wrecking Ball', 'Symmetra', 'Torbjörn']);
  });

  it('counts an UNKNOWN hero as a player kill, not a deployable', () => {
    // A brand-new hero GEP knows before this build does should still have their
    // deaths counted. The safe failure is a real elimination counted as one.
    const s = reduceLiveMatch(live(), destroy('SOMENEWHERO'), 1001);
    expect(s.kills).toEqual({ yours: 1, theirs: 0 });
    expect(s.feed[0].deployable).toBeUndefined();
  });

  it('counts an enemy destroying YOUR deployable as neither side\'s elimination', () => {
    const s = reduceLiveMatch(live(), destroy('Illari Healing Pylon', { is_attacker_teammate: false }), 1001);
    expect(s.kills).toEqual({ yours: 0, theirs: 0 });
  });
});

describe('reduceLiveMatch — revives name the supporter and the revived', () => {
  it('reads the supporter/revived fields rather than the kill fields', () => {
    // A revive carries `supporter`/`revived`, not `attacker`/`victim`; reading
    // the wrong pair rendered "someone revived a teammate".
    const s = reduceLiveMatch(live(), event('kill_feed', JSON.stringify({
      attacker: '', victim: '', supporter: 'Kiriko', revived: 'Karambo',
      supporter_hero_name: 'KIRIKO', revived_hero_name: 'REINHARDT',
      is_attacker_teammate: true,
    })), 1001);
    expect(s.feed[0]).toMatchObject({
      revive: true, attacker: 'Kiriko', victim: 'Karambo',
      attackerHero: 'Kiriko', victimHero: 'Reinhardt',
    });
    expect(s.kills).toEqual({ yours: 0, theirs: 0 });
  });
});
