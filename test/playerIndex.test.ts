import { describe, it, expect } from 'vitest';
import { playerHistory, playerMatchHistory, playerRecords } from '../src/core/playerIndex';
import type { GameRecord } from '../src/core/analytics';
import type { Result, RosterPlayer } from '../src/core/model';

let seq = 0;
function game(p: Partial<GameRecord> & { result: Result }): GameRecord {
  return {
    matchId: p.matchId ?? `g-${++seq}`,
    timestamp: p.timestamp ?? 1_000_000 + seq * 1000,
    account: 'Main',
    role: 'damage',
    map: "King's Row",
    gameType: 'Competitive',
    heroes: ['Tracer'],
    ...p,
  };
}

const me: RosterPlayer = { battleTag: 'Karambo#21234', heroName: 'Tracer', isLocal: true };
const other = (battleTag: string): RosterPlayer => ({ battleTag, heroName: 'Ana' });

describe('playerHistory', () => {
  it('counts prior encounters per player, excluding the target match itself', () => {
    const target = game({ result: 'Win', matchId: 't', roster: [me, other('Nova#11214'), other('Vex#2321')] });
    const all = [
      game({ result: 'Win', timestamp: 2000, roster: [me, other('Nova#11214')] }),
      game({ result: 'Loss', timestamp: 5000, roster: [me, other('Nova#11214'), other('Ghost#21058')] }),
      game({ result: 'Win', timestamp: 3000, roster: [me, other('Vex#2321')] }),
      target,
    ];
    const history = playerHistory(all, target);
    expect(history.map((p) => p.name)).toEqual(['Nova#11214', 'Vex#2321']); // most encounters first
    const nova = history[0];
    expect(nova.encounters).toBe(2);
    expect(nova.lastSeen).toBe(5000);
    expect(nova.results).toEqual({ wins: 1, losses: 1 });
    expect(history[1]).toMatchObject({ encounters: 1, lastSeen: 3000 });
    // Ghost was never in the target match — not listed.
    expect(history.find((p) => p.name.startsWith('Ghost'))).toBeUndefined();
  });

  it('normalizes names: Name#123 and bare lowercase name are the same player', () => {
    const target = game({ result: 'Win', matchId: 't', roster: [me, other('Vex#2321')] });
    const all = [
      game({ result: 'Win', roster: [me, other('vex')] }),
      game({ result: 'Loss', roster: [me, other('VEX#9999')] }),
      target,
    ];
    const history = playerHistory(all, target);
    expect(history).toHaveLength(1);
    expect(history[0].encounters).toBe(2);
    expect(history[0].name).toBe('Vex#2321'); // the full battleTag is preferred
  });

  it('excludes the tracked player from the index', () => {
    const target = game({ result: 'Win', matchId: 't', roster: [me, other('Nova#11214')] });
    const all = [
      game({ result: 'Win', roster: [me, other('Nova#11214')] }),
      target,
    ];
    const history = playerHistory(all, target);
    expect(history.find((p) => p.name.startsWith('Karambo'))).toBeUndefined();
  });

  it('tolerates matches without rosters on both sides', () => {
    const bare = game({ result: 'Win', matchId: 'bare' }); // legacy record, no roster
    const withRoster = game({ result: 'Win', roster: [me, other('Nova#11214')] });
    expect(playerHistory([bare, withRoster], bare)).toEqual([]);
    const target = game({ result: 'Win', matchId: 't', roster: [me, other('Nova#11214')] });
    // Rosterless games in the history are simply skipped, not fatal.
    const history = playerHistory([bare, withRoster, target], target);
    expect(history).toHaveLength(1);
    expect(history[0].encounters).toBe(1);
  });

  it('counts a shared match once even if a name appears twice in its roster', () => {
    const target = game({ result: 'Win', matchId: 't', roster: [me, other('Nova#11214')] });
    const dup = game({ result: 'Win', roster: [me, other('Nova#11214'), other('nova')] });
    const history = playerHistory([dup, target], target);
    expect(history[0].encounters).toBe(1);
  });
});

const meT = (team: number): RosterPlayer => ({ battleTag: 'Karambo#21234', heroName: 'Tracer', team, isLocal: true });
const them = (battleTag: string, team: number, heroName = 'Ana'): RosterPlayer => ({ battleTag, heroName, team });

describe('playerMatchHistory', () => {
  it('lists every shared match newest-first with team relation, hero + a W/L split', () => {
    const all = [
      game({ result: 'Win', matchId: 'a', timestamp: 3000, map: 'Ilios', roster: [meT(0), them('Nova#11214', 0, 'Ana')] }),  // teammate, win
      game({ result: 'Loss', matchId: 'b', timestamp: 5000, map: 'Nepal', roster: [meT(1), them('Nova#11214', 0, 'Kiriko')] }), // enemy, loss
      game({ result: 'Win', matchId: 'c', timestamp: 1000, roster: [meT(0), them('Ghost#5', 1)] }), // different player
    ];
    const h = playerMatchHistory(all, 'Nova#11214')!;
    expect(h.name).toBe('Nova#11214');
    expect(h.encounters).toBe(2);
    expect(h.lastSeen).toBe(5000);
    expect(h.matches.map((m) => m.matchId)).toEqual(['b', 'a']); // newest first
    expect(h.matches[0]).toMatchObject({ map: 'Nepal', result: 'Loss', sameTeam: false, hero: 'Kiriko' });
    expect(h.matches[1]).toMatchObject({ map: 'Ilios', result: 'Win', sameTeam: true, hero: 'Ana' });
    expect(h.results).toEqual({ wins: 1, losses: 1 });
    expect(h.sameTeam).toEqual({ wins: 1, losses: 0 });
    expect(h.enemyTeam).toEqual({ wins: 0, losses: 1 });
  });

  it('returns a single match when met once', () => {
    const h = playerMatchHistory([game({ result: 'Win', roster: [meT(0), them('Solo#1', 0)] })], 'Solo#1')!;
    expect(h.encounters).toBe(1);
    expect(h.matches).toHaveLength(1);
  });

  it('normalizes names and prefers the #-tagged display', () => {
    const all = [
      game({ result: 'Win', roster: [meT(0), them('vex', 0)] }),
      game({ result: 'Loss', roster: [meT(0), them('VEX#9999', 1)] }),
    ];
    const h = playerMatchHistory(all, 'vex')!;
    expect(h.encounters).toBe(2);
    expect(h.name).toBe('VEX#9999');
  });

  it('never targets the tracked (local) player, and returns null for an empty/unknown name', () => {
    const all = [game({ result: 'Win', roster: [meT(0), them('Nova#11214', 0)] })];
    expect(playerMatchHistory(all, 'Karambo#21234')).toBeNull(); // local player excluded
    expect(playerMatchHistory(all, '')).toBeNull();
    expect(playerMatchHistory(all, 'Nobody#0')).toBeNull();
  });

  it('omits the team relation when the feed did not report teams', () => {
    const meNoTeam: RosterPlayer = { battleTag: 'Karambo#21234', heroName: 'Tracer', isLocal: true };
    const themNoTeam: RosterPlayer = { battleTag: 'Nova#11214', heroName: 'Ana' };
    const h = playerMatchHistory([game({ result: 'Win', roster: [meNoTeam, themNoTeam] })], 'Nova#11214')!;
    expect(h.matches[0].sameTeam).toBeUndefined();
    expect(h.sameTeam).toEqual({ wins: 0, losses: 0 });
    expect(h.enemyTeam).toEqual({ wins: 0, losses: 0 });
    expect(h.results).toEqual({ wins: 1, losses: 0 }); // still counts your result
  });
});

describe('playerRecords', () => {
  // Team relation is only known when BOTH rows carry a team — that is the whole
  // point of the with/vs split, so these fixtures always set one.
  const meT = (team: number): RosterPlayer => ({ ...me, team });
  const themT = (battleTag: string, team: number): RosterPlayer => ({ battleTag, heroName: 'Ana', team });

  it('splits your record into games WITH them and AGAINST them', () => {
    const all = [
      game({ result: 'Win', roster: [meT(0), themT('Nova#1', 0)] }),
      game({ result: 'Win', roster: [meT(0), themT('Nova#1', 0)] }),
      game({ result: 'Loss', roster: [meT(0), themT('Nova#1', 0)] }),
      game({ result: 'Loss', roster: [meT(0), themT('Nova#1', 1)] }),
    ];
    const [nova] = playerRecords(all, ['Nova#1']);
    expect(nova).toMatchObject({
      name: 'Nova#1',
      encounters: 4,
      sameTeam: { wins: 2, losses: 1 },
      enemyTeam: { wins: 0, losses: 1 },
    });
  });

  it('answers for a whole roster in one call', () => {
    const all = [
      game({ result: 'Win', roster: [meT(0), themT('A#1', 0), themT('B#2', 1)] }),
      game({ result: 'Loss', roster: [meT(0), themT('B#2', 0)] }),
    ];
    const rows = playerRecords(all, ['A#1', 'B#2', 'C#3']);
    expect(rows.map((r) => r.name)).toEqual(['B#2', 'A#1']); // most encounters first
    expect(rows.find((r) => r.name === 'B#2')).toMatchObject({
      encounters: 2, sameTeam: { wins: 0, losses: 1 }, enemyTeam: { wins: 1, losses: 0 },
    });
  });

  it('omits players you have never shared a match with', () => {
    const all = [game({ result: 'Win', roster: [meT(0), themT('A#1', 0)] })];
    expect(playerRecords(all, ['Stranger#9']).map((r) => r.name)).toEqual([]);
  });

  it('matches on the name before the #, like every other player lookup', () => {
    const all = [game({ result: 'Win', roster: [meT(0), themT('Nova#11214', 0)] })];
    // A different discriminator, and different casing — same person.
    expect(playerRecords(all, ['nova#99999'])[0]).toMatchObject({ encounters: 1 });
  });

  it('counts a shared match once even if the feed listed them twice', () => {
    const all = [game({ result: 'Win', roster: [meT(0), themT('A#1', 0), themT('A#1', 0)] })];
    expect(playerRecords(all, ['A#1'])[0].encounters).toBe(1);
  });

  it('counts the encounter but no W/L when the feed reported no teams', () => {
    // Without both teams "with" and "vs" would be a guess, and telling those
    // apart is the entire feature.
    const all = [game({ result: 'Win', roster: [me, { battleTag: 'A#1', heroName: 'Ana' }] })];
    expect(playerRecords(all, ['A#1'])[0]).toMatchObject({
      encounters: 1, sameTeam: { wins: 0, losses: 0 }, enemyTeam: { wins: 0, losses: 0 },
    });
  });

  it('never counts a draw as a win or a loss', () => {
    const all = [game({ result: 'Draw', roster: [meT(0), themT('A#1', 0)] })];
    expect(playerRecords(all, ['A#1'])[0]).toMatchObject({
      encounters: 1, sameTeam: { wins: 0, losses: 0 },
    });
  });

  it('ignores the local player and unidentified rows', () => {
    const all = [game({ result: 'Win', roster: [meT(0), { heroName: 'Ana', team: 1 }] })];
    expect(playerRecords(all, ['Karambo#21234', ''])).toEqual([]);
  });

  it('returns nothing for an empty name list, without walking history', () => {
    expect(playerRecords([game({ result: 'Win', roster: [meT(0), themT('A#1', 0)] })], [])).toEqual([]);
  });

  it('agrees with playerMatchHistory on the same split', () => {
    // The two answer the same question at different weights; they must not drift.
    const all = [
      game({ result: 'Win', roster: [meT(0), themT('Nova#1', 0)] }),
      game({ result: 'Loss', roster: [meT(0), themT('Nova#1', 1)] }),
    ];
    const batched = playerRecords(all, ['Nova#1'])[0];
    const single = playerMatchHistory(all, 'Nova#1')!;
    expect(batched.sameTeam).toEqual(single.sameTeam);
    expect(batched.enemyTeam).toEqual(single.enemyTeam);
    expect(batched.encounters).toBe(single.encounters);
  });
});
