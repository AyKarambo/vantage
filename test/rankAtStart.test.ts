import { describe, it, expect } from 'vitest';
import { createDataProvider, type DataProviderDeps } from '../src/main/dataProvider';
import { rankEnteringMatch, rankKey, type RankAnchor, type RankAnchorMap } from '../src/core/rank';
import type { PlacementRun } from '../src/core/placements';
import type { GameRecord } from '../src/core/analytics';
import type { Role } from '../src/core/model';

/**
 * `rankAtStart`: the rank the player was sitting at going INTO a match, stored
 * as a snapshot rather than derived on read.
 *
 * The rule has exactly two halves, and both matter:
 *  - a match that records a ±% gets a snapshot;
 *  - a match with no ±% gets none, and one that LOSES its ±% gets it cleared.
 */

const ACCOUNT = 'Main';
const ROLE: Role = 'tank';
const T0 = 1_700_000_000_000;
const MINUTE = 60_000;

const g = (n: number, over: Partial<GameRecord> = {}): GameRecord => ({
  matchId: `m-${n}`,
  timestamp: T0 + n * MINUTE,
  account: ACCOUNT,
  role: ROLE,
  result: 'Win',
  map: 'Ilios',
  gameType: 'Competitive',
  source: 'manual',
  heroes: ['Winston'],
  ...over,
} as GameRecord);

const anchor = (over: Partial<RankAnchor> = {}): RankAnchor & { account: string; role: Role } => ({
  account: ACCOUNT, role: ROLE, tier: 'Gold', division: 3, progressPct: 40, setAt: T0 - MINUTE, ...over,
});

function harness(games: GameRecord[], initialAnchor?: ReturnType<typeof anchor>) {
  const history = [...games];
  const anchors: Record<string, ReturnType<typeof anchor>> = {};
  if (initialAnchor) anchors[rankKey(initialAnchor.account, initialAnchor.role)] = initialAnchor;
  const runs: Record<string, PlacementRun> = {};
  const deps = {
    history: {
      all: () => history,
      count: () => history.length,
      setReview: () => {},
      editManual: (matchId: string, patch: Record<string, unknown>) => {
        const game = history.find((x) => x.matchId === matchId);
        if (!game) return false;
        const t = game as unknown as Record<string, unknown>;
        for (const [k, v] of Object.entries(patch)) {
          if (v === null) delete t[k];
          else if (v !== undefined) t[k] = v;
        }
        return true;
      },
    },
    rankAnchors: {
      all: () => Object.values(anchors),
      get: (a: string, r: Role) => anchors[rankKey(a, r)],
      map: (): RankAnchorMap => {
        const out: RankAnchorMap = {};
        for (const x of Object.values(anchors)) {
          out[rankKey(x.account, x.role)] = { tier: x.tier, division: x.division, progressPct: x.progressPct, setAt: x.setAt };
        }
        return out;
      },
      set: () => {}, remove: () => {}, relabel: () => 0, removeAccount: () => 0,
    },
    placements: {
      allRuns: () => Object.values(runs),
      getRun: (a: string, r: Role) => runs[rankKey(a, r)],
      setRun: (run: PlacementRun) => { runs[rankKey(run.account, run.role)] = run; },
      removeRun: () => {}, declinedFor: () => [], addDeclined: () => {},
      relabel: () => 0, removeAccount: () => 0,
    },
    masterDataStore: { all: () => ({ heroes: {}, maps: {}, seasons: {} }) },
    getConfig: () => ({ accounts: {}, ui: { demoPreference: 'off' } }),
    recordGame: (game: GameRecord) => { history.push(game); return true; },
    notify: () => {},
  } as unknown as DataProviderDeps;
  const at = (id: string): GameRecord | undefined => history.find((x) => x.matchId === id);
  return { provider: createDataProvider(deps), history, at, runs };
}

const review = (matchId: string, srDelta: number | null): unknown =>
  ({ matchId, grades: {}, flags: {}, srDelta });

describe('rankAtStart — the snapshot', () => {
  it('records where you stood going into the match when a delta is saved', () => {
    // Anchor Gold 3 - 40%, then two matches. The second was entered at the
    // position the first left you on.
    const { provider, at } = harness([g(1), g(2)], anchor());
    provider.saveReview(review('m-1', 20) as never);
    provider.saveReview(review('m-2', -10) as never);

    expect(at('m-1')!.rankAtStart).toEqual({ tier: 'Gold', division: 3, progressPct: 40 });
    expect(at('m-2')!.rankAtStart).toEqual({ tier: 'Gold', division: 3, progressPct: 60 });
  });

  it('records nothing for a match with no delta', () => {
    // Without a rank change the ladder did not move here, so a value would only
    // repeat the previous match and imply a progression Vantage cannot vouch for.
    const { provider, at } = harness([g(1)], anchor());
    provider.saveReview({ matchId: 'm-1', grades: {}, flags: {} } as never);
    expect(at('m-1')!.rankAtStart).toBeUndefined();
  });

  it('CLEARS the snapshot when the delta is removed again', () => {
    const { provider, at } = harness([g(1)], anchor());
    provider.saveReview(review('m-1', 20) as never);
    expect(at('m-1')!.rankAtStart).toBeDefined();

    provider.saveReview(review('m-1', null) as never);
    expect(at('m-1')!.rankAtStart).toBeUndefined();
  });

  it('records nothing when the track has no rank anchor to snapshot from', () => {
    const { provider, at } = harness([g(1)]); // no anchor
    provider.saveReview(review('m-1', 20) as never);
    expect(at('m-1')!.rankAtStart).toBeUndefined();
  });

  it('records nothing for a non-competitive match', () => {
    const { provider, at } = harness([g(1, { gameType: 'Unranked' })], anchor());
    provider.saveReview(review('m-1', 20) as never);
    expect(at('m-1')!.rankAtStart).toBeUndefined();
  });

  it('is a SNAPSHOT: correcting an older match never rewrites a newer one', () => {
    // The whole reason it is stored. Every other rank figure recomputes from the
    // delta chain, so fixing match 1 would silently restate what you had going
    // into match 2 — a rank you never actually saw.
    const { provider, at } = harness([g(1), g(2)], anchor());
    provider.saveReview(review('m-1', 20) as never);
    provider.saveReview(review('m-2', -10) as never);
    const before = at('m-2')!.rankAtStart;

    provider.saveReview(review('m-1', 5) as never); // correction to the OLDER match

    expect(at('m-2')!.rankAtStart).toEqual(before);
  });

  it('is written once — re-saving the same review does not move it', () => {
    const { provider, at } = harness([g(1)], anchor());
    provider.saveReview(review('m-1', 20) as never);
    const first = at('m-1')!.rankAtStart;
    provider.saveReview(review('m-1', 20) as never);
    expect(at('m-1')!.rankAtStart).toEqual(first);
  });

  it('stamps a hand-logged match that carries its delta straight away', () => {
    const { provider, history } = harness([], anchor());
    provider.logMatch({
      result: 'Win', role: ROLE, map: 'Ilios', gameType: 'Competitive', account: ACCOUNT, srDelta: 22,
    } as never);
    expect(history[0].rankAtStart).toEqual({ tier: 'Gold', division: 3, progressPct: 40 });
  });

  it('leaves a hand-logged match without a delta unstamped', () => {
    const { provider, history } = harness([], anchor());
    provider.logMatch({
      result: 'Win', role: ROLE, map: 'Ilios', gameType: 'Competitive', account: ACCOUNT,
    } as never);
    expect(history[0].rankAtStart).toBeUndefined();
  });

  it('picks it up from the match editor too', () => {
    const { provider, at } = harness([g(1)], anchor());
    provider.editMatch({ matchId: 'm-1', srDelta: 15 } as never);
    expect(at('m-1')!.rankAtStart).toEqual({ tier: 'Gold', division: 3, progressPct: 40 });
  });
});

describe('rankEnteringMatch', () => {
  const map = (a: ReturnType<typeof anchor>): RankAnchorMap => ({
    [rankKey(a.account, a.role)]: { tier: a.tier, division: a.division, progressPct: a.progressPct, setAt: a.setAt },
  });

  it('is null without an anchor — a fabricated rank would be worse than a blank', () => {
    expect(rankEnteringMatch([g(1)], {}, ACCOUNT, ROLE, T0 + MINUTE)).toBeNull();
  });

  it('is the anchor itself for the first match after it', () => {
    const a = anchor();
    expect(rankEnteringMatch([g(1)], map(a), ACCOUNT, ROLE, g(1).timestamp))
      .toMatchObject({ tier: 'Gold', division: 3, progressPct: 40 });
  });

  it('is where the previous match on the track left you', () => {
    const a = anchor();
    const games = [g(1, { srDelta: 20 }), g(2)];
    expect(rankEnteringMatch(games, map(a), ACCOUNT, ROLE, games[1].timestamp))
      .toMatchObject({ progressPct: 60 });
  });

  it('ignores matches on another track', () => {
    const a = anchor();
    const games = [g(1, { srDelta: 20, role: 'damage' }), g(2)];
    expect(rankEnteringMatch(games, map(a), ACCOUNT, ROLE, games[1].timestamp))
      .toMatchObject({ progressPct: 40 });
  });

  it('ignores a delta the app is suppressing for an open placement run', () => {
    // Same read-time mask every other rank surface applies: a match inside an
    // open run has no settled rank to move yet.
    const a = anchor();
    const games = [g(1, { srDelta: 20 }), g(2)];
    const suppressed = new Set(['m-1']);
    expect(rankEnteringMatch(games, map(a), ACCOUNT, ROLE, games[1].timestamp, suppressed))
      .toMatchObject({ progressPct: 40 });
  });
});
