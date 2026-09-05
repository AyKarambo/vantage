import { describe, it, expect } from 'vitest';
import {
  PLAYER_ROW_CAP, normalizePlayerSelection, playerDirectory, playerHistory, playerMatchHistory,
  playerRecords, selectPlayers,
} from '../src/core/playerIndex';
import type { GameRecord } from '../src/core/analytics';
import type { Result, RosterPlayer } from '../src/core/model';
import type { EnteringRank } from '../src/core/rank';
import type { PlayerListQuery, PlayerListRow, PlayerSortKey } from '../src/shared/contract';

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

  // The card used to render the COMBINED record under the word "together".
  it('splits the record by team relation instead of repeating the combined one', () => {
    const target = game({ result: 'Win', matchId: 't', roster: [meT(1), them('Nova#11214', 1)] });
    const all = [
      game({ result: 'Win', timestamp: 2000, roster: [meT(1), them('Nova#11214', 1)] }),
      game({ result: 'Loss', timestamp: 3000, roster: [meT(1), them('Nova#11214', 1)] }),
      game({ result: 'Win', timestamp: 4000, roster: [meT(1), them('Nova#11214', 2)] }),
      target,
    ];
    const nova = playerHistory(all, target)[0];
    expect(nova.encounters).toBe(3);
    expect(nova.relationKnown).toBe(3);
    expect(nova.sameTeam).toEqual({ wins: 1, losses: 1 });
    expect(nova.enemyTeam).toEqual({ wins: 1, losses: 0 });
    // The combined record stays available and is deliberately NOT either split.
    expect(nova.results).toEqual({ wins: 2, losses: 1 });
  });

  it('leaves both splits empty and relationKnown at 0 when the feed reported no teams', () => {
    const target = game({ result: 'Win', matchId: 't', roster: [me, other('Nova#11214')] });
    const all = [
      game({ result: 'Win', timestamp: 2000, roster: [me, other('Nova#11214')] }),
      game({ result: 'Loss', timestamp: 3000, roster: [me, other('Nova#11214')] }),
      target,
    ];
    const nova = playerHistory(all, target)[0];
    expect(nova.encounters).toBe(2);
    // Zero because nothing is KNOWN — the caller renders a dash, not 0W-0L.
    expect(nova.relationKnown).toBe(0);
    expect(nova.sameTeam).toEqual({ wins: 0, losses: 0 });
    expect(nova.enemyTeam).toEqual({ wins: 0, losses: 0 });
    expect(nova.results).toEqual({ wins: 1, losses: 1 });
  });

  it('counts a half-known history honestly: splits cover only the games with teams', () => {
    const target = game({ result: 'Win', matchId: 't', roster: [meT(1), them('Nova#11214', 1)] });
    const all = [
      game({ result: 'Win', timestamp: 2000, roster: [meT(1), them('Nova#11214', 2)] }),
      // No teams reported on this one.
      game({ result: 'Win', timestamp: 3000, roster: [me, other('Nova#11214')] }),
      target,
    ];
    const nova = playerHistory(all, target)[0];
    expect(nova.encounters).toBe(2);
    expect(nova.relationKnown).toBe(1);
    // Together + as-opponents deliberately does NOT equal encounters.
    expect(nova.sameTeam).toEqual({ wins: 0, losses: 0 });
    expect(nova.enemyTeam).toEqual({ wins: 1, losses: 0 });
  });

  it('moves neither split on a draw, but still counts the encounter', () => {
    const target = game({ result: 'Win', matchId: 't', roster: [meT(1), them('Nova#11214', 1)] });
    const all = [game({ result: 'Draw', timestamp: 2000, roster: [meT(1), them('Nova#11214', 1)] }), target];
    const nova = playerHistory(all, target)[0];
    expect(nova.encounters).toBe(1);
    expect(nova.relationKnown).toBe(1);
    expect(nova.sameTeam).toEqual({ wins: 0, losses: 0 });
    expect(nova.results).toEqual({ wins: 0, losses: 0 });
  });

  // The split must never disagree with the live board's numbers for the same pair.
  it('agrees with playerRecords on the same fixture', () => {
    const target = game({ result: 'Win', matchId: 't', roster: [meT(1), them('Nova#11214', 1)] });
    const shared = [
      game({ result: 'Win', timestamp: 2000, roster: [meT(1), them('Nova#11214', 1)] }),
      game({ result: 'Loss', timestamp: 3000, roster: [meT(1), them('Nova#11214', 2)] }),
    ];
    const nova = playerHistory([...shared, target], target)[0];
    // playerRecords sees the target match too, so compare over the same slice.
    const rec = playerRecords(shared, ['Nova#11214'])[0];
    expect(nova.sameTeam).toEqual(rec.sameTeam);
    expect(nova.enemyTeam).toEqual(rec.enemyTeam);
    expect(nova.encounters).toBe(rec.encounters);
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

  it('carries your own role, account and heroes for the table', () => {
    const all = [game({
      result: 'Win', role: 'support', account: 'Alt', heroes: ['Ana', 'Kiriko'],
      roster: [meT(0), them('Nova#11214', 0, 'Genji')],
    })];
    const m = playerMatchHistory(all, 'Nova#11214')!.matches[0];
    expect(m).toMatchObject({ role: 'support', account: 'Alt', heroes: ['Ana', 'Kiriko'], hero: 'Genji' });
  });

  it("derives their role from GEP's heroRole first, then the hero table, and never guesses", () => {
    const all = [
      // GEP said so outright — its historical spelling normalizes to 'damage'.
      game({ result: 'Win', matchId: 'a', timestamp: 3000, roster: [meT(0), { battleTag: 'Nova#11214', heroName: 'Genji', heroRole: 'offense', team: 0 }] }),
      // No heroRole: derived from the hero table.
      game({ result: 'Win', matchId: 'b', timestamp: 2000, roster: [meT(0), { battleTag: 'Nova#11214', heroName: 'Ana', team: 0 }] }),
      // Neither — a masked slot stays blank rather than being guessed.
      game({ result: 'Win', matchId: 'c', timestamp: 1000, roster: [meT(0), { battleTag: 'Nova#11214', team: 0 }] }),
    ];
    const byId = new Map(playerMatchHistory(all, 'Nova#11214')!.matches.map((m) => [m.matchId, m]));
    expect(byId.get('a')!.theirRole).toBe('damage');
    expect(byId.get('b')!.theirRole).toBe('support');
    expect(byId.get('c')!.theirRole).toBeUndefined();
    expect(byId.get('c')!.hero).toBeUndefined();
  });

  it('attaches the entering rank from a prebuilt map, collapsing derived notes', () => {
    const all = [
      game({ result: 'Win', matchId: 'stored', timestamp: 3000, roster: [meT(0), them('Nova#11214', 0)] }),
      game({ result: 'Win', matchId: 'calc', timestamp: 2000, roster: [meT(0), them('Nova#11214', 0)] }),
      game({ result: 'Win', matchId: 'blank', timestamp: 1000, roster: [meT(0), them('Nova#11214', 0)] }),
    ];
    const ranks = new Map<string, EnteringRank>([
      ['stored', { note: 'stored', position: { tier: 'Gold', division: 3, progressPct: 40 } }],
      // Both engine notes must reach the wire as one 'derived' badge...
      ['calc', { note: 'calculated', position: { tier: 'Gold', division: 2, progressPct: 10 }, protected: true }],
      ['blank', { note: 'placements' }],
    ]);
    const byId = new Map(playerMatchHistory(all, 'Nova#11214', undefined, ranks)!.matches.map((m) => [m.matchId, m]));
    expect(byId.get('stored')!.rank).toEqual({ note: 'stored', tier: 'Gold', division: 3, progressPct: 40 });
    expect(byId.get('calc')!.rank).toEqual({ note: 'derived', tier: 'Gold', division: 2, progressPct: 10 });
    // ...and `protected` must NOT reach it: the backward walk can't recover it,
    // so no surface built on this DTO may draw a shield.
    expect(byId.get('calc')!.rank).not.toHaveProperty('protected');
    expect(byId.get('blank')!.rank).toEqual({ note: 'placements' });
  });

  it('leaves rank absent entirely when no map is supplied', () => {
    const all = [game({ result: 'Win', roster: [meT(0), them('Nova#11214', 0)] })];
    expect(playerMatchHistory(all, 'Nova#11214')!.matches[0].rank).toBeUndefined();
  });

  it('passes a negative progress percent through verbatim (a protection carry)', () => {
    const all = [game({ result: 'Loss', matchId: 'm', roster: [meT(0), them('Nova#11214', 0)] })];
    const ranks = new Map<string, EnteringRank>([
      ['m', { note: 'calculated', position: { tier: 'Gold', division: 3, progressPct: -19 }, protected: true }],
    ]);
    expect(playerMatchHistory(all, 'Nova#11214', undefined, ranks)!.matches[0].rank?.progressPct).toBe(-19);
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

describe('playerDirectory', () => {
  it('aggregates every player met, one encounter per game, newest name preferred', () => {
    const all = [
      game({ result: 'Win', timestamp: 3000, roster: [meT(0), them('Nova#11214', 0), them('Vex#2321', 1)] }),
      game({ result: 'Loss', timestamp: 5000, roster: [meT(1), them('Nova#11214', 0)] }),
      // The same person in two slots must still count as ONE shared game.
      game({ result: 'Win', timestamp: 6000, roster: [meT(0), them('Vex#2321', 0), them('vex', 0)] }),
    ];
    const d = playerDirectory(all);
    // Both have 2 games, so the tie-break is most-recent-first.
    expect(d.players.map((p) => p.name)).toEqual(['Vex#2321', 'Nova#11214']);
    expect(d.players[0]).toMatchObject({ games: 2, lastSeen: 6000 });
    expect(d.players[1]).toMatchObject({ games: 2, lastSeen: 5000 });
    expect(d.scannedGames).toBe(3);
    expect(d.gamesWithRoster).toBe(3);
  });

  it('splits the record by team relation, and leaves it empty when teams are unreported', () => {
    const all = [
      game({ result: 'Win', roster: [meT(0), them('Nova#11214', 0)] }),
      game({ result: 'Loss', roster: [meT(0), them('Nova#11214', 1)] }),
      game({ result: 'Win', roster: [me, other('Nova#11214')] }), // no teams
    ];
    const row = playerDirectory(all).players[0];
    expect(row.games).toBe(3);
    expect(row.sameTeam).toEqual({ wins: 1, losses: 0 });
    expect(row.enemyTeam).toEqual({ wins: 0, losses: 1 });
  });

  it('never lists the tracked player', () => {
    const all = [game({ result: 'Win', roster: [meT(0), them('Nova#11214', 0)] })];
    expect(playerDirectory(all).players.map((p) => p.name)).toEqual(['Nova#11214']);
  });

  it('reports how many games carried a roster, so an empty screen can say why', () => {
    const all = [game({ result: 'Win' }), game({ result: 'Win', roster: [meT(0), them('Nova#11214', 0)] })];
    const d = playerDirectory(all);
    expect(d.scannedGames).toBe(2);
    expect(d.gamesWithRoster).toBe(1);
  });

  it('flags a row where the name-before-# merge folded two real tags together', () => {
    const all = [
      game({ result: 'Win', roster: [meT(0), them('Nova#1111', 0)] }),
      game({ result: 'Win', roster: [meT(0), them('Nova#2222', 0)] }),
      game({ result: 'Win', roster: [meT(0), them('Vex#2321', 0)] }),
    ];
    const byName = new Map(playerDirectory(all).players.map((p) => [p.name, p]));
    // Documented limit, not a bug — but the row says it may be two people.
    expect(byName.get('Nova#1111')!.games).toBe(2);
    expect(byName.get('Nova#1111')!.ambiguous).toBe(true);
    expect(byName.get('Vex#2321')!.ambiguous).toBe(false);
  });

  it('does not treat a bare name plus its own tag as ambiguous', () => {
    const all = [
      game({ result: 'Win', roster: [meT(0), them('nova', 0)] }),
      game({ result: 'Win', roster: [meT(0), them('Nova#1111', 0)] }),
    ];
    const row = playerDirectory(all).players[0];
    expect(row.name).toBe('Nova#1111');
    expect(row.ambiguous).toBe(false);
  });

  it('orders by games desc, then last seen, then key — deterministically', () => {
    const all = [
      game({ result: 'Win', timestamp: 1000, roster: [meT(0), them('Bravo#2', 0)] }),
      game({ result: 'Win', timestamp: 2000, roster: [meT(0), them('Alpha#1', 0)] }),
      game({ result: 'Win', timestamp: 3000, roster: [meT(0), them('Alpha#1', 0)] }),
    ];
    expect(playerDirectory(all).players.map((p) => p.name)).toEqual(['Alpha#1', 'Bravo#2']);
    // Same input twice → same order (codepoint compare, no localeCompare).
    expect(playerDirectory(all).players).toEqual(playerDirectory(all).players);
  });

  it('walks the history exactly once', () => {
    let reads = 0;
    const games: GameRecord[] = [];
    for (let i = 0; i < 500; i++) {
      const g = game({ result: 'Win', timestamp: i * 1000 });
      const roster = [meT(0), them(`P${i % 40}#1`, i % 2)];
      Object.defineProperty(g, 'roster', { get() { reads++; return roster; } });
      games.push(g);
    }
    playerDirectory(games);
    // The loop reads `roster` twice per game (the length guard, then the walk);
    // what matters is that it is O(games), never O(games x players).
    expect(reads).toBeLessThanOrEqual(1500);
  });

  it('agrees with playerRecords on the same fixture', () => {
    const all = [
      game({ result: 'Win', timestamp: 2000, roster: [meT(0), them('Nova#11214', 0)] }),
      game({ result: 'Loss', timestamp: 3000, roster: [meT(0), them('Nova#11214', 1)] }),
      game({ result: 'Draw', timestamp: 4000, roster: [meT(0), them('Nova#11214', 0)] }),
    ];
    const row = playerDirectory(all).players[0];
    const rec = playerRecords(all, ['Nova#11214'])[0];
    expect(row.sameTeam).toEqual(rec.sameTeam);
    expect(row.enemyTeam).toEqual(rec.enemyTeam);
    expect(row.lastSeen).toEqual(rec.lastSeen);
    expect(row.games).toBe(rec.encounters);
  });

  it('returns nothing for an empty history without throwing', () => {
    expect(playerDirectory([])).toEqual({ players: [], scannedGames: 0, gamesWithRoster: 0 });
  });
});

describe('selectPlayers / normalizePlayerSelection', () => {
  const row = (over: Partial<PlayerListRow>): PlayerListRow => ({
    key: 'nova', name: 'Nova#1111', games: 1, lastSeen: 1000,
    sameTeam: { wins: 0, losses: 0 }, enemyTeam: { wins: 0, losses: 0 }, ambiguous: false, ...over,
  });
  const sel = (over: Partial<PlayerListQuery> = {}) => normalizePlayerSelection({ filters: {}, ...over });

  it('defaults to most shared games first', () => {
    const players = [row({ key: 'a', name: 'A#1', games: 2 }), row({ key: 'b', name: 'B#1', games: 9 })];
    expect(selectPlayers(players, sel()).rows.map((p) => p.name)).toEqual(['B#1', 'A#1']);
  });

  it('caps AFTER sorting, and reports the uncapped total', () => {
    const players = Array.from({ length: 500 }, (_, i) => row({ key: `p${i}`, name: `P${i}#1`, games: i + 1 }));
    const out = selectPlayers(players, sel());
    expect(out.rows).toHaveLength(PLAYER_ROW_CAP);
    expect(out.matched).toBe(500);
    // The top of the sorted set, not the top of an arbitrary page.
    expect(out.rows[0].games).toBe(500);
  });

  // The whole reason sorting happens on main: sorting a capped page would give
  // "the 200 most-played, re-ordered by date" while claiming to be "most recent".
  it('sorting by last seen returns the genuinely most recent, not a re-ordered page', () => {
    const players = [
      ...Array.from({ length: 400 }, (_, i) => row({ key: `old${i}`, name: `Old${i}#1`, games: 40, lastSeen: 1000 })),
      row({ key: 'fresh', name: 'Fresh#1', games: 1, lastSeen: 9_999_999 }),
    ];
    const out = selectPlayers(players, sel({ sort: 'lastSeen' }));
    expect(out.rows[0].name).toBe('Fresh#1');
  });

  it('searches the identity and the displayed tag, case-insensitively', () => {
    const players = [row({ key: 'nova', name: 'Nova#1111' }), row({ key: 'vex', name: 'Vex#2321' })];
    expect(selectPlayers(players, sel({ search: 'nov' })).rows.map((p) => p.name)).toEqual(['Nova#1111']);
    expect(selectPlayers(players, sel({ search: 'NOVA' })).rows).toHaveLength(1);
    // A discriminator degrades to the identity — the row IS the merged Nova.
    expect(selectPlayers(players, sel({ search: 'nova#2222' })).rows).toHaveLength(1);
    // ...while the raw query can still discriminate against the displayed tag.
    expect(selectPlayers(players, sel({ search: '#11' })).rows.map((p) => p.name)).toEqual(['Nova#1111']);
    expect(selectPlayers(players, sel({ search: 'nobody' })))
      .toEqual({ rows: [], matched: 0 });
    expect(selectPlayers(players, sel({ search: '   ' })).rows).toHaveLength(2);
  });

  it('search filters but never re-ranks — the chosen column still orders', () => {
    const players = [
      row({ key: 'nova1', name: 'Nova#1', games: 2 }),
      row({ key: 'nova2', name: 'Novaa#2', games: 9 }),
    ];
    expect(selectPlayers(players, sel({ search: 'nova' })).rows.map((p) => p.games)).toEqual([9, 2]);
  });

  it('applies the minimum-games floor and reflects it in the total', () => {
    const players = [row({ key: 'a', name: 'A#1', games: 1 }), row({ key: 'b', name: 'B#1', games: 7 })];
    const out = selectPlayers(players, sel({ minGames: 5 }));
    expect(out.rows.map((p) => p.name)).toEqual(['B#1']);
    expect(out.matched).toBe(1);
  });

  it('sinks players with no decided games in BOTH sort directions', () => {
    const players = [
      row({ key: 'none', name: 'None#1', games: 5 }),
      row({ key: 'good', name: 'Good#1', games: 5, sameTeam: { wins: 5, losses: 0 } }),
      row({ key: 'bad', name: 'Bad#1', games: 5, sameTeam: { wins: 0, losses: 5 } }),
    ];
    for (const dir of [1, -1] as const) {
      const names = selectPlayers(players, sel({ sort: 'with', dir })).rows.map((p) => p.name);
      expect(names[names.length - 1], `dir ${dir}`).toBe('None#1');
    }
  });

  it('normalizes hostile input rather than trusting the wire', () => {
    expect(normalizePlayerSelection(undefined)).toEqual({
      search: '', minGames: 1, sort: 'games', dir: -1, limit: PLAYER_ROW_CAP,
    });
    expect(sel({ sort: 'nonsense' as PlayerSortKey }).sort).toBe('games');
    expect(sel({ dir: 3 as 1 }).dir).toBe(-1);
    expect(sel({ minGames: Number('abc') }).minGames).toBe(1);
    expect(sel({ minGames: -5 }).minGames).toBe(1);
    expect(sel({ minGames: 2.7 }).minGames).toBe(2);
    expect(sel({ search: 'x'.repeat(10_000) }).search).toHaveLength(64);
    expect(sel({ search: 42 as unknown as string }).search).toBe('');
  });

  it('does not mutate the directory it selects from', () => {
    const players = [row({ key: 'a', name: 'A#1', games: 1 }), row({ key: 'b', name: 'B#1', games: 9 })];
    const order = players.map((p) => p.name);
    selectPlayers(players, sel({ sort: 'lastSeen' }));
    expect(players.map((p) => p.name)).toEqual(order);
  });
});

/**
 * Guardrails 1 and 5 as observable behaviour, not just prose: the local player
 * is never a row or a click target anywhere in the player index, and nothing
 * derived from a roster can reach the only outbound path the app has.
 */
describe('player index — guardrails', () => {
  const roster = [meT(0), them('Nova#11214', 0), them('Vex#2321', 1)];

  it('never lists the tracked player in any surface', () => {
    const target = game({ result: 'Win', matchId: 't', roster });
    const all = [game({ result: 'Win', timestamp: 2000, roster }), target];
    const localTag = 'Karambo#21234';

    expect(playerDirectory(all).players.some((p) => p.name === localTag)).toBe(false);
    expect(playerHistory(all, target).some((p) => p.name === localTag)).toBe(false);
    expect(playerRecords(all, [localTag])).toEqual([]);
    // ...and asking for them by name yields no drill-down at all.
    expect(playerMatchHistory(all, localTag)).toBeNull();
  });

  it('keeps every roster-derived field out of the Notion export schema', async () => {
    const { REQUIRED_PROPERTIES } = await import('../src/notion/gametrackerSchema');
    const columns = Object.keys(REQUIRED_PROPERTIES).map((k) => k.toLowerCase());
    for (const forbidden of ['roster', 'opponent', 'teammate', 'encounter', 'player', 'enemy']) {
      expect(columns.some((c) => c.includes(forbidden)), `${forbidden} must not be exported`).toBe(false);
    }
  });
});
