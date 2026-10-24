import { describe, it, expect } from 'vitest';
import { autoParty, effectiveGroupSize, normalizeMembers, ownTeammates, partyFromInput, partyKey } from '../src/core/party';
import type { RosterPlayer } from '../src/core/model';

const me: RosterPlayer = { battleTag: 'Me#1111', isLocal: true, team: 0 };

describe('partyKey / normalizeMembers', () => {
  it('keys by the lowercased name without the discriminator', () => {
    expect(partyKey(' Alice#1234 ')).toBe('alice');
  });

  it('trims, drops empties and dedupes by key, keeping the first spelling and order', () => {
    expect(normalizeMembers(['  Alice#1234 ', '', '   ', 'Bob', 'alice', '#9', 'BOB#7'])).toEqual(['Alice#1234', 'Bob']);
  });
});

describe('effectiveGroupSize', () => {
  it('is members + 1 when a party is recorded, overriding the GEP count', () => {
    expect(effectiveGroupSize({ party: { members: ['A', 'B'], source: 'manual' }, groupSize: 1 })).toBe(3);
  });
  it('treats an empty party as explicit solo', () => {
    expect(effectiveGroupSize({ party: { members: [], source: 'manual' }, groupSize: 4 })).toBe(1);
  });
  it('falls back to the GEP count, or undefined', () => {
    expect(effectiveGroupSize({ groupSize: 2 })).toBe(2);
    expect(effectiveGroupSize({})).toBeUndefined();
  });
});

describe('ownTeammates', () => {
  it('returns same-team non-local players only', () => {
    const roster: RosterPlayer[] = [
      me,
      { battleTag: 'Mate#1', team: 0 },
      { battleTag: 'Enemy#2', team: 1 },
    ];
    expect(ownTeammates(roster)).toEqual(['Mate#1']);
  });
  it('returns every non-local player when the local team is unknown or there is no local entry', () => {
    expect(ownTeammates([{ battleTag: 'Me', isLocal: true }, { battleTag: 'A', team: 0 }, { battleTag: 'B', team: 1 }])).toEqual(['A', 'B']);
    expect(ownTeammates([{ battleTag: 'A', team: 0 }, { battleTag: 'B', team: 1 }])).toEqual(['A', 'B']);
  });
  it('dedupes by key, skips blank names, and handles a missing roster', () => {
    expect(ownTeammates([me, { battleTag: 'A#1', team: 0 }, { battleTag: 'a', team: 0 }, { battleTag: ' ', team: 0 }, { team: 0 }])).toEqual(['A#1']);
    expect(ownTeammates(undefined)).toEqual([]);
  });
});

describe('autoParty', () => {
  const roster: RosterPlayer[] = [
    me,
    { battleTag: 'Alice#1234', team: 0 },
    { battleTag: 'Rando#5', team: 0 },
    { battleTag: 'Bob#9', team: 1 },
  ];
  const friends = new Set(['alice']);

  it('labels a game when the friends on the team account for the whole party', () => {
    expect(autoParty({ groupSize: 2, roster }, friends)).toEqual({ members: ['Alice#1234'], source: 'auto' });
  });
  it('matches a friend regardless of the discriminator', () => {
    expect(autoParty({ groupSize: 2, roster: [me, { battleTag: 'Alice', team: 0 }] }, friends)).toEqual({ members: ['Alice'], source: 'auto' });
  });
  it('is undefined when no friend is on the team (enemy friend does not count)', () => {
    expect(autoParty({ groupSize: 2, roster }, new Set(['bob']))).toBeUndefined();
  });
  it('is undefined when too few or too many friends are found', () => {
    expect(autoParty({ groupSize: 3, roster }, friends)).toBeUndefined();
    expect(autoParty({ groupSize: 2, roster }, new Set(['alice', 'rando']))).toBeUndefined();
  });
  it('is undefined for unknown or solo group sizes', () => {
    expect(autoParty({ roster }, friends)).toBeUndefined();
    expect(autoParty({ groupSize: 1, roster }, friends)).toBeUndefined();
  });
  it('never overrides an existing party', () => {
    expect(autoParty({ groupSize: 2, roster, party: { members: [], source: 'manual' } }, friends)).toBeUndefined();
  });
});

describe('autoParty — team safety (review fix)', () => {
  it('records nothing when the local team is unknown but the roster tells teams apart', () => {
    const roster = [
      { battleTag: 'Me#1', isLocal: true },
      { battleTag: 'Alice#2', team: 1 },
      { battleTag: 'Carol#3', team: 0 },
    ];
    expect(autoParty({ groupSize: 2, roster }, new Set(['alice']))).toBeUndefined();
  });

  it('still labels when no roster entry carries a team (local-team-only feed)', () => {
    const roster = [{ battleTag: 'Me#1', isLocal: true }, { battleTag: 'Alice#2' }];
    expect(autoParty({ groupSize: 2, roster }, new Set(['alice']))).toEqual({ members: ['Alice#2'], source: 'auto' });
  });
});

describe('partyFromInput', () => {
  it('maps null, members, Solo and malformed input', () => {
    expect(partyFromInput(null)).toBeNull();
    expect(partyFromInput({ members: [' Alice#1 ', 'alice', 3] })).toEqual({ members: ['Alice#1'], source: 'manual' });
    expect(partyFromInput({ members: [] })).toEqual({ members: [], source: 'manual' });
    expect(partyFromInput(undefined)).toBeUndefined();
    expect(partyFromInput({ members: 'x' })).toBeUndefined();
  });
});
