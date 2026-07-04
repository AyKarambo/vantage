import { describe, it, expect } from 'vitest';
import { playerHistory } from '../src/core/playerIndex';
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
