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

  it('clears the previous match\'s roster and feed when a new one starts', () => {
    let s = live();
    s = reduceLiveMatch(s, roster(0, { battle_tag: 'Old#1', kills: 9, deaths: 4 }), 1001);
    s = reduceLiveMatch(s, event('kill_feed', JSON.stringify({ attacker: 'A', victim: 'B' })), 1002);
    expect(s.feed).toHaveLength(1);
    s = reduceLiveMatch(s, start(), 2000);
    expect(s.roster).toEqual({});
    expect(liveTeamTotals(liveRoster(s)).deathsKnown).toBe(false);
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

  it('records every kill in the feed, tagged with which side the attacker was on', () => {
    let s = live();
    s = reduceLiveMatch(s, kill(), 1001);
    s = reduceLiveMatch(s, kill({ is_attacker_teammate: false }), 1002);
    expect(s.feed.map((k) => k.attackerFriendly)).toEqual([false, true]);
  });

  it('keeps no running count of its own — team deaths come off the roster', () => {
    // The kill feed used to be summed into an elimination tally. Nothing is
    // summed from it any more, so the state carries no such field to drift.
    const s = reduceLiveMatch(live(), kill(), 1001);
    expect(s).not.toHaveProperty('kills');
  });

  it('marks a revive as a revive', () => {
    let s = live();
    s = reduceLiveMatch(s, kill({ revived: 'Mate', revived_hero_name: 'ANA' }), 1001);
    expect(s.feed[0].revive).toBe(true);
  });

  it('records the entry even when the feed omits the team relation', () => {
    let s = live();
    s = reduceLiveMatch(s, kill({ is_attacker_teammate: undefined }), 1001);
    expect(s.feed).toHaveLength(1);
    expect(s.feed[0].attackerFriendly).toBeUndefined();
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
    expect(s.feed).toHaveLength(1);
    expect(s.feed[0]).toMatchObject({ attacker: 'brandy', victimHero: 'Sojourn', attackerFriendly: false });
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
    // presence rather than content would label every kill in the feed a revive.
    const s = reduceLiveMatch(live(), event('kill_feed', JSON.stringify(payload)), 1001);
    expect(s.feed[0].revive).toBeUndefined();
  });
});

describe('liveTeamTotals', () => {
  const p = (over: Record<string, unknown>) => over as never;

  it('sums damage, healing and deaths per side', () => {
    const roster = [
      p({ isLocal: true, team: 0, damage: 2000, healing: 6000, deaths: 4 }),
      p({ team: 0, damage: 3000, healing: 500, deaths: 2 }),
      p({ team: 1, damage: 4000, healing: 100, deaths: 5 }),
      p({ team: 1, damage: 1000, healing: 2000, deaths: 1 }),
    ];
    expect(liveTeamTotals(roster)).toEqual({
      yours: { damage: 5000, healing: 6500, deaths: 6 },
      theirs: { damage: 5000, healing: 2100, deaths: 6 },
      known: true,
      deathsKnown: true,
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

  describe('deaths', () => {
    it('counts one per death, however many players were credited with the elimination', () => {
      // One of your players died to a five-credit pick: the enemy's elimination
      // column grows by 5, but exactly one player of yours is down — and nobody
      // of theirs — so deaths read 1–0, not the 5–1 an elimination total would.
      const roster = [
        p({ isLocal: true, team: 0, kills: 1, deaths: 1 }),
        p({ team: 0, kills: 0, deaths: 0 }),
        p({ team: 1, kills: 5, deaths: 0 }),
        p({ team: 1, kills: 0, deaths: 0 }),
      ];
      const t = liveTeamTotals(roster);
      expect(t.yours.deaths).toBe(1);
      expect(t.theirs.deaths).toBe(0);
    });

    it('is known once each side has reported a deaths value, zero included', () => {
      // 0 is a report ("nobody has died yet"), unlike an absent field.
      const roster = [p({ isLocal: true, team: 0, deaths: 0 }), p({ team: 1, deaths: 0 })];
      expect(liveTeamTotals(roster).deathsKnown).toBe(true);
    });

    it('is withheld when a side never reported deaths, rather than shown as a confident 0', () => {
      const roster = [
        p({ isLocal: true, team: 0, deaths: 3 }),
        p({ team: 1, damage: 500 }), // no deaths field at all
      ];
      const t = liveTeamTotals(roster);
      expect(t.known).toBe(true);
      expect(t.deathsKnown).toBe(false);
    });

    it('is withheld when the feed gave no teams, whatever the rows say', () => {
      const roster = [p({ isLocal: true, deaths: 3 }), p({ deaths: 2 })];
      expect(liveTeamTotals(roster).deathsKnown).toBe(false);
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
    // Damage, healing and deaths are TAB-screen numbers, not kill-derived —
    // which is why they survive the kill feed being switched off.
    let s = live();
    s = reduceLiveMatch(s, roster(0, { battle_tag: 'Me#1', is_local: true, team: 0, damage: 1200, healed: 3400, deaths: 2 }), 1001);
    s = reduceLiveMatch(s, roster(1, { battle_tag: 'Foe#2', team: 1, damage: 800, healed: 100, deaths: 3 }), 1002);
    expect(liveTeamTotals(liveRoster(s))).toEqual({
      yours: { damage: 1200, healing: 3400, deaths: 2 },
      theirs: { damage: 800, healing: 100, deaths: 3 },
      known: true,
      deathsKnown: true,
    });
  });

  it('follows a player\'s deaths as the roster ticks up, merging partial snapshots', () => {
    let s = live();
    s = reduceLiveMatch(s, roster(0, { battle_tag: 'Me#1', is_local: true, team: 0, deaths: 1 }), 1001);
    s = reduceLiveMatch(s, roster(1, { battle_tag: 'Foe#2', team: 1, deaths: 0 }), 1002);
    s = reduceLiveMatch(s, roster(0, { deaths: 2 }), 1003); // a tick carrying only the changed field
    const t = liveTeamTotals(liveRoster(s));
    expect(t.yours.deaths).toBe(2);
    expect(t.theirs.deaths).toBe(0);
  });
});

describe('reduceLiveMatch — deployables are tagged in the feed', () => {
  /**
   * Overwatch reports destroying a turret or pylon as an ordinary kill event —
   * victim `Takigano`, victim hero `Illari Healing Pylon`. Nobody died, so the
   * feed marks it as a destroy rather than a kill.
   */
  const destroy = (victimHero: string, over: Record<string, unknown> = {}) =>
    event('kill_feed', JSON.stringify({
      attacker: 'Kirito', victim: 'Takigano', is_attacker_teammate: true,
      attacker_hero_name: 'PHARAH', victim_hero_name: victimHero, ...over,
    }));

  it('records a destroyed Healing Pylon, tagged with its owner and what it was', () => {
    const s = reduceLiveMatch(live(), destroy('Illari Healing Pylon'), 1001);
    expect(s.feed[0]).toMatchObject({
      attacker: 'Kirito', victim: 'Takigano',
      deployable: { hero: 'Illari', label: 'Healing Pylon' },
    });
  });

  it('does not tag a kill on the HERO of the same name', () => {
    // The discriminator must not swallow Illari herself.
    const s = reduceLiveMatch(live(), destroy('ILLARI'), 1001);
    expect(s.feed[0].deployable).toBeUndefined();
  });

  it('handles other heroes\' deployables the same way, with no hard-coded list', () => {
    let s = live();
    s = reduceLiveMatch(s, destroy('Torbjörn Turret'), 1001);
    s = reduceLiveMatch(s, destroy('Symmetra Teleporter'), 1002);
    s = reduceLiveMatch(s, destroy('Wrecking Ball Minefield'), 1003);
    expect(s.feed.map((k) => k.deployable?.hero)).toEqual(['Wrecking Ball', 'Symmetra', 'Torbjörn']);
  });

  it('treats an UNKNOWN hero as a player, not a deployable', () => {
    // A brand-new hero GEP knows before this build does should read as a normal
    // kill. The safe failure is a real kill shown as one.
    const s = reduceLiveMatch(live(), destroy('SOMENEWHERO'), 1001);
    expect(s.feed[0].deployable).toBeUndefined();
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
  });

  it('reads a self-revive (the supporter and the revived are the same player) as a revive', () => {
    const s = reduceLiveMatch(live(), event('kill_feed', JSON.stringify({
      attacker: '', victim: '', supporter: 'Karambo', revived: 'Karambo',
      supporter_hero_name: 'ANRAN', revived_hero_name: 'ANRAN',
    })), 1001);
    expect(s.feed[0]).toMatchObject({ revive: true, attackerHero: 'Anran', victimHero: 'Anran' });
  });
});

describe('team deaths ignore the kill feed entirely', () => {
  /**
   * The requirement: a team's deaths are real player deaths. A destroyed turret
   * or pylon, a Mercy resurrect and Anran's self-revive all arrive as kill-feed
   * lines, and none of them may move the number. They cannot, because deaths are
   * summed off the roster's own death counters — this pins that down so a
   * feed-derived count is never quietly reintroduced.
   */
  it('is unmoved by destroyed deployables and revives', () => {
    let s = live();
    s = reduceLiveMatch(s, roster(0, { battle_tag: 'Me#1', is_local: true, team: 0, deaths: 2 }), 1001);
    s = reduceLiveMatch(s, roster(1, { battle_tag: 'Foe#2', team: 1, deaths: 1 }), 1002);
    const before = liveTeamTotals(liveRoster(s));

    s = reduceLiveMatch(s, event('kill_feed', JSON.stringify({
      attacker: 'Kirito', victim: 'Takigano', is_attacker_teammate: true,
      attacker_hero_name: 'PHARAH', victim_hero_name: 'Illari Healing Pylon',
    })), 1003);
    s = reduceLiveMatch(s, event('kill_feed', JSON.stringify({
      supporter: 'Mercy#1', revived: 'Me#1', supporter_hero_name: 'MERCY', revived_hero_name: 'ANA',
    })), 1004);
    s = reduceLiveMatch(s, event('kill_feed', JSON.stringify({
      supporter: 'Foe#2', revived: 'Foe#2', supporter_hero_name: 'ANRAN', revived_hero_name: 'ANRAN',
    })), 1005);

    expect(s.feed).toHaveLength(3);
    expect(liveTeamTotals(liveRoster(s))).toEqual(before);
    expect(before.yours.deaths).toBe(2);
    expect(before.theirs.deaths).toBe(1);
  });

  it('is unmoved by kill-feed kills too — only the roster counter moves it', () => {
    let s = live();
    s = reduceLiveMatch(s, roster(0, { battle_tag: 'Me#1', is_local: true, team: 0, deaths: 0 }), 1001);
    s = reduceLiveMatch(s, roster(1, { battle_tag: 'Foe#2', team: 1, deaths: 0 }), 1002);
    s = reduceLiveMatch(s, event('kill_feed', JSON.stringify({
      attacker: 'Me', victim: 'Foe', is_attacker_teammate: true, is_victim_teammate: false,
    })), 1003);
    expect(liveTeamTotals(liveRoster(s)).theirs.deaths).toBe(0);
    s = reduceLiveMatch(s, roster(1, { deaths: 1 }), 1004);
    expect(liveTeamTotals(liveRoster(s)).theirs.deaths).toBe(1);
  });
});
