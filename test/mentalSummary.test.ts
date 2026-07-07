import { describe, it, expect } from 'vitest';
import { mentalSummary } from '../src/core/mental';
import type { GameRecord } from '../src/core/analytics';
import type { Result, Role } from '../src/core/model';

// ---- fixtures -------------------------------------------------------------

function game(p: Partial<GameRecord> & { result: Result; map: string; role: Role }): GameRecord {
  return {
    matchId: Math.random().toString(36).slice(2),
    timestamp: Date.now(),
    account: 'Main',
    gameType: 'Competitive',
    heroes: ['Tracer'],
    ...p,
  };
}

const base = { map: 'Ilios', role: 'damage' as Role };

describe('mentalSummary — decided-sample counts', () => {
  it('tiltedDecided/calmDecided exclude draws from their respective groups', () => {
    const games = [
      // Tilted group: 2 decided (1W/1L) + 1 draw → tiltedDecided should be 2, not 3.
      game({ ...base, result: 'Win', mental: { tilt: true } }),
      game({ ...base, result: 'Loss', mental: { tilt: true } }),
      game({ ...base, result: 'Draw', mental: { tilt: true } }),
      // Calm group: 2 decided (1W/1L) + 1 draw → calmDecided should be 2, not 3.
      game({ ...base, result: 'Win' }),
      game({ ...base, result: 'Loss' }),
      game({ ...base, result: 'Draw' }),
    ];
    const m = mentalSummary(games);
    expect(m.flags.tilt).toBe(3); // all-tilt-flagged count still includes the draw
    expect(m.tiltedDecided).toBe(2);
    expect(m.calmDecided).toBe(2);
  });

  it('tilted draws alone leave tiltedDecided at 0 despite flags.tilt > 0 (guards the tilt-tax claim)', () => {
    const games = [
      game({ ...base, result: 'Draw', mental: { tilt: true } }),
      game({ ...base, result: 'Draw', mental: { tilt: true } }),
      game({ ...base, result: 'Draw', mental: { tilt: true } }),
      game({ ...base, result: 'Draw', mental: { tilt: true } }),
      game({ ...base, result: 'Draw', mental: { tilt: true } }),
    ];
    const m = mentalSummary(games);
    expect(m.flags.tilt).toBe(5);
    expect(m.tiltedDecided).toBe(0);
    expect(m.winWhenTilted).toBe(0); // 0/0 sentinel — must not be trusted without the guard above
  });

  it('an all-tilted history leaves the calm side with calmDecided 0', () => {
    const games = [
      game({ ...base, result: 'Win', mental: { tilt: true } }),
      game({ ...base, result: 'Loss', mental: { tilt: true } }),
      game({ ...base, result: 'Loss', mental: { tilt: true } }),
    ];
    const m = mentalSummary(games);
    expect(m.calmDecided).toBe(0);
    expect(m.winWhenCalm).toBe(0); // 0/0 sentinel on the calm side too
    expect(m.tiltedDecided).toBe(3);
  });

  it('a healthy split reports the decided count on both sides (wins+losses, no draws)', () => {
    const games = [
      game({ ...base, result: 'Win', mental: { tilt: true } }),
      game({ ...base, result: 'Win', mental: { tilt: true } }),
      game({ ...base, result: 'Loss', mental: { tilt: true } }),
      game({ ...base, result: 'Win' }),
      game({ ...base, result: 'Win' }),
      game({ ...base, result: 'Loss' }),
    ];
    const m = mentalSummary(games);
    expect(m.tiltedDecided).toBe(3);
    expect(m.calmDecided).toBe(3);
  });

  it('is zero on both sides for no games', () => {
    const m = mentalSummary([]);
    expect(m.tiltedDecided).toBe(0);
    expect(m.calmDecided).toBe(0);
  });
});

describe('mentalSummary — comms tone', () => {
  it('scores a new comms:positive game identically to a legacy positiveComms game', () => {
    const withTone = mentalSummary([game({ ...base, result: 'Win', mental: { comms: 'positive' } })]);
    const withLegacy = mentalSummary([game({ ...base, result: 'Win', mental: { positiveComms: true } })]);
    expect(withTone.flags.positiveComms).toBe(1);
    expect(withLegacy.flags.positiveComms).toBe(1);
    expect(withTone.calm).toBe(withLegacy.calm);
  });

  it('counts abusive comms in flags.abusive and does not raise calm', () => {
    const abusive = mentalSummary([game({ ...base, result: 'Win', mental: { comms: 'abusive' } })]);
    const positive = mentalSummary([game({ ...base, result: 'Win', mental: { comms: 'positive' } })]);
    expect(abusive.flags.abusive).toBe(1);
    expect(abusive.flags.positiveComms).toBe(0);
    // Abusive is non-positive → it must not lift calm the way positive does.
    expect(abusive.calm).toBeLessThan(positive.calm);
  });

  it('treats banter as neutral — no positive credit, no abusive count', () => {
    const banter = mentalSummary([game({ ...base, result: 'Win', mental: { comms: 'banter' } })]);
    const none = mentalSummary([game({ ...base, result: 'Win' })]);
    expect(banter.flags.positiveComms).toBe(0);
    expect(banter.flags.abusive).toBe(0);
    expect(banter.calm).toBe(none.calm);
  });
});
