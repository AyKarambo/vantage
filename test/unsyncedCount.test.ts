import { describe, it, expect } from 'vitest';
import {
  countUnsyncedGames, countCompetitiveGames, gameNeedsSync, matchExportSignature,
  type MatchExportLedger,
} from '../src/core/targets';
import type { GameRecord } from '../src/core/analytics';

function game(matchId: string, overrides: Partial<GameRecord> = {}): GameRecord {
  return {
    matchId,
    timestamp: Date.now(),
    account: 'Main',
    role: 'damage',
    map: 'Ilios',
    result: 'Win',
    gameType: 'Competitive',
    heroes: ['Tracer'],
    ...overrides,
  } as GameRecord;
}

/** Signature of a blank match (no grade, no flags) — what a freshly-logged game has. */
const BLANK_SIG = matchExportSignature(game('x'), undefined);
const sigOf = (g: GameRecord) => matchExportSignature(g, undefined);

describe('gameNeedsSync', () => {
  it('needs sync when never exported (no ledgered page id), whatever the signature', () => {
    expect(gameNeedsSync(BLANK_SIG, { pageId: undefined, signature: undefined })).toBe(true);
    expect(gameNeedsSync(BLANK_SIG, { pageId: undefined, signature: BLANK_SIG })).toBe(true);
  });

  it('needs sync when the recorded signature differs from the current one (changed since export)', () => {
    expect(gameNeedsSync('new-sig', { pageId: 'p1', signature: 'old-sig' })).toBe(true);
  });

  it('does NOT need sync when ledgered with a matching signature (unchanged)', () => {
    expect(gameNeedsSync(BLANK_SIG, { pageId: 'p1', signature: BLANK_SIG })).toBe(false);
  });
});

describe('countUnsyncedGames', () => {
  /** A ledger over an in-memory map of matchId → {pageId, signature}. */
  function ledger(entries: Record<string, MatchExportLedger>) {
    return (matchId: string): MatchExportLedger => entries[matchId] ?? { pageId: undefined, signature: undefined };
  }

  it('counts never-exported OR changed-since-export competitive games (spec AC: 12 never + 3 changed = 15)', () => {
    const games: GameRecord[] = [];
    const entries: Record<string, MatchExportLedger> = {};

    // 12 never-exported (no ledger entry at all)
    for (let i = 0; i < 12; i++) games.push(game(`new-${i}`));
    // 3 changed-since-export (ledgered, but the recorded signature is stale)
    for (let i = 0; i < 3; i++) {
      const id = `changed-${i}`;
      games.push(game(id));
      entries[id] = { pageId: `p-${id}`, signature: 'stale-signature' };
    }
    // 20 already-synced (ledgered with the current signature) — must NOT count
    for (let i = 0; i < 20; i++) {
      const id = `synced-${i}`;
      games.push(game(id));
      entries[id] = { pageId: `p-${id}`, signature: BLANK_SIG };
    }

    expect(countUnsyncedGames(games, sigOf, ledger(entries))).toBe(15);
  });

  it('excludes non-competitive games even when they have never been exported', () => {
    const games = [
      game('comp-1'),
      game('qp-1', { gameType: 'Quick Play' }),
      game('arcade-1', { gameType: 'Arcade' }),
    ];
    // Nothing is ledgered → only the competitive game counts.
    expect(countUnsyncedGames(games, sigOf, ledger({}))).toBe(1);
  });

  it('reports 0 when every competitive game is exported and unchanged (up to date)', () => {
    const games = [game('a'), game('b'), game('c')];
    const entries: Record<string, MatchExportLedger> = {
      a: { pageId: 'pa', signature: BLANK_SIG },
      b: { pageId: 'pb', signature: BLANK_SIG },
      c: { pageId: 'pc', signature: BLANK_SIG },
    };
    expect(countUnsyncedGames(games, sigOf, ledger(entries))).toBe(0);
    expect(countCompetitiveGames(games)).toBe(3); // ...but there ARE competitive games (→ "up to date", not "none yet")
  });
});

describe('countCompetitiveGames', () => {
  it('counts only competitive rows, so the UI can tell "none yet" (0) from "up to date"', () => {
    const games = [
      game('c1'),
      game('c2'),
      game('qp', { gameType: 'Quick Play' }),
    ];
    expect(countCompetitiveGames(games)).toBe(2);
    expect(countCompetitiveGames([])).toBe(0);
    expect(countCompetitiveGames([game('qp', { gameType: 'Quick Play' })])).toBe(0);
  });
});
