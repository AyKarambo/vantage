import { describe, it, expect } from 'vitest';
import { createDataProvider, type DataProviderDeps } from '../src/main/dataProvider';
import { currentRank, rankKey, type RankAnchor, type RankAnchorMap } from '../src/core/rank';
import type { PlacementRun } from '../src/core/placements';
import type { GameRecord } from '../src/core/analytics';
import type { Role } from '../src/core/model';

/**
 * The placement provider's contract is almost entirely about REVERSIBILITY, so
 * these tests are written the same way: do a thing, undo it, and assert the
 * observable rank is byte-identical to what it was before — not merely
 * "plausible". `currentRank` is the oracle throughout, because that is what
 * every rank surface in the app actually renders.
 */

const ACCOUNT = 'Main';
const ROLE: Role = 'tank';
const T0 = 1_700_000_000_000;
const MINUTE = 60_000;

/** A competitive match on the tracked (account, role), `n` minutes after T0. */
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
  const declined: Record<string, number[]> = {};
  let recordedGames = 0;

  const deps = {
    history: {
      all: () => history,
      add: () => { recordedGames++; },
      editManual: () => { recordedGames++; },
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
      set: (rec: ReturnType<typeof anchor>) => { anchors[rankKey(rec.account, rec.role)] = rec; return rec; },
      remove: (a: string, r: Role) => delete anchors[rankKey(a, r)],
      relabel: () => 0,
      removeAccount: () => 0,
    },
    placements: {
      allRuns: () => Object.values(runs),
      getRun: (a: string, r: Role) => runs[rankKey(a, r)],
      setRun: (run: PlacementRun) => { runs[rankKey(run.account, run.role)] = run; return run; },
      removeRun: (a: string, r: Role) => delete runs[rankKey(a, r)],
      declinedFor: (a: string, r: Role) => declined[rankKey(a, r)] ?? [],
      addDeclined: () => undefined,
      relabel: () => 0,
      removeAccount: () => 0,
    },
    getConfig: () => ({ accounts: {} }),
  } as unknown as DataProviderDeps;

  const provider = createDataProvider(deps);
  const rankNow = () => currentRank(history, deps.rankAnchors.map(), ACCOUNT, ROLE);
  const anchorNow = () => anchors[rankKey(ACCOUNT, ROLE)];
  return { provider, rankNow, anchorNow, runs, history, recorded: () => recordedGames };
}

/** Ten placement matches, each carrying a delta that must stay dormant while the run is open. */
const tenMatches = () => Array.from({ length: 10 }, (_, i) => g(i + 1, { srDelta: 20 }));

const track = { account: ACCOUNT, role: ROLE };

describe('placement runs — start and complete', () => {
  it('completion anchors at the LAST counted match, not the wall clock', () => {
    const games = tenMatches();
    const { provider, anchorNow } = harness(games, anchor());
    provider.startPlacementRun({ ...track, fromMatchId: 'm-1' });
    provider.completePlacementRun({ ...track, tier: 'Platinum', division: 2 });
    // The 10th match's timestamp — so competitiveComps (strictly after the
    // anchor) excludes every placement match from the rank arithmetic.
    expect(anchorNow().setAt).toBe(games[9].timestamp);
    expect(anchorNow()).toMatchObject({ tier: 'Platinum', division: 2, progressPct: 0 });
  });

  it('the ten placement matches do not move the post-placement rank', () => {
    const { provider, rankNow } = harness(tenMatches(), anchor());
    provider.startPlacementRun({ ...track, fromMatchId: 'm-1' });
    provider.completePlacementRun({ ...track, tier: 'Platinum', division: 2 });
    // Each carries srDelta 20; none may apply, or the confirmed rank would drift.
    expect(rankNow()).toMatchObject({ tier: 'Platinum', division: 2, progressPct: 0 });
  });

  it('reports progress and the latest prediction', () => {
    const { provider } = harness(tenMatches().slice(0, 4), anchor());
    provider.startPlacementRun({ ...track, fromMatchId: 'm-1' });
    provider.setPlacementPrediction({ ...track, matchId: 'm-2', prediction: { tier: 'Gold', division: 1 } });
    const [summary] = provider.setPlacementPrediction({
      ...track, matchId: 'm-3', prediction: { tier: 'Platinum', division: 5 },
    });
    expect(summary).toMatchObject({ counted: 4, target: 10, completed: false, drifted: false });
    expect(summary.latestPrediction).toEqual({ tier: 'Platinum', division: 5 });
  });
});

describe('placement runs — reversibility', () => {
  it('reset after completion restores the exact pre-run rank', () => {
    const { provider, rankNow } = harness(tenMatches(), anchor());
    const before = rankNow();
    provider.startPlacementRun({ ...track, fromMatchId: 'm-1' });
    provider.completePlacementRun({ ...track, tier: 'Platinum', division: 2 });
    expect(rankNow()).not.toEqual(before);

    provider.resetPlacementRun(track);
    expect(rankNow()).toEqual(before);
  });

  it('reset restores "no anchor" when the track never had one', () => {
    const { provider, anchorNow, rankNow } = harness(tenMatches());
    expect(rankNow()).toBeNull();
    provider.startPlacementRun({ ...track, fromMatchId: 'm-1' });
    provider.completePlacementRun({ ...track, tier: 'Silver', division: 4 });
    expect(anchorNow()).toBeDefined();

    provider.resetPlacementRun(track);
    // Not "leave the placement result standing" — the player never set a rank,
    // so undoing has to mean unanchored again.
    expect(anchorNow()).toBeUndefined();
    expect(rankNow()).toBeNull();
  });

  it('reset keeps the run open at zero, clearing predictions', () => {
    const { provider } = harness(tenMatches(), anchor());
    provider.startPlacementRun({ ...track, fromMatchId: 'm-1' });
    provider.setPlacementPrediction({ ...track, matchId: 'm-2', prediction: { tier: 'Gold', division: 1 } });
    provider.completePlacementRun({ ...track, tier: 'Platinum', division: 2 });

    const [summary] = provider.resetPlacementRun(track);
    expect(summary).toMatchObject({ completed: false, drifted: false });
    expect(summary.latestPrediction).toBeUndefined();
  });

  it('cancel restores the pre-run rank and drops the run entirely', () => {
    const { provider, rankNow } = harness(tenMatches(), anchor());
    const before = rankNow();
    provider.startPlacementRun({ ...track, fromMatchId: 'm-1' });
    provider.completePlacementRun({ ...track, tier: 'Platinum', division: 2 });

    expect(provider.cancelPlacementRun(track)).toEqual([]);
    expect(rankNow()).toEqual(before);
  });

  it('a backdated match keeps its delta, dormant while open and live again after cancel', () => {
    const games = [g(1, { srDelta: 22 }), g(2, { srDelta: -19 })];
    const { provider, rankNow, history } = harness(games, anchor());
    const withDeltas = rankNow();

    provider.startPlacementRun({ ...track, fromMatchId: 'm-1' });
    // The stored records are untouched — suppression is a read-time concern.
    expect(history.map((x) => x.srDelta)).toEqual([22, -19]);

    provider.cancelPlacementRun(track);
    expect(rankNow()).toEqual(withDeltas);
  });

  it('no placement operation writes or edits a match record', () => {
    const { provider, recorded } = harness(tenMatches(), anchor());
    provider.startPlacementRun({ ...track, fromMatchId: 'm-1' });
    provider.setPlacementPrediction({ ...track, matchId: 'm-1', prediction: { tier: 'Gold', division: 2 } });
    provider.completePlacementRun({ ...track, tier: 'Platinum', division: 2 });
    provider.resetPlacementRun(track);
    provider.cancelPlacementRun(track);
    expect(recorded()).toBe(0);
  });

  it('restarting a completed run keeps the ORIGINAL pre-run anchor as the undo target', () => {
    const { provider, rankNow } = harness(tenMatches(), anchor());
    const original = rankNow();
    provider.startPlacementRun({ ...track, fromMatchId: 'm-1' });
    provider.completePlacementRun({ ...track, tier: 'Platinum', division: 2 });

    // Restart, complete differently, then undo: must land on the ORIGINAL rank,
    // not on the first run's result.
    provider.startPlacementRun({ ...track, fromMatchId: 'm-1' });
    provider.completePlacementRun({ ...track, tier: 'Diamond', division: 5 });
    provider.resetPlacementRun(track);
    expect(rankNow()).toEqual(original);
  });

  it('reset on an OPEN run leaves a hand-set anchor alone', () => {
    const { provider, anchorNow } = harness(tenMatches().slice(0, 3), anchor());
    provider.startPlacementRun({ ...track, fromMatchId: 'm-1' });
    // The player re-anchors by hand mid-run; the run never wrote anything.
    provider.setRankAnchor({ ...track, tier: 'Emerald', division: 4, progressPct: 10 });

    provider.resetPlacementRun(track);
    expect(anchorNow()).toMatchObject({ tier: 'Emerald', division: 4 });
  });
});

describe('placement runs — drift and recount', () => {
  it('flags drift when a counted match leaves the track, without reopening', () => {
    const games = tenMatches();
    const { provider, history, anchorNow } = harness(games, anchor());
    provider.startPlacementRun({ ...track, fromMatchId: 'm-1' });
    provider.completePlacementRun({ ...track, tier: 'Platinum', division: 2 });
    const completedAnchor = anchorNow();

    history.splice(history.findIndex((x) => x.matchId === 'm-5'), 1);
    const [summary] = provider.getPlacements();
    expect(summary).toMatchObject({ completed: true, drifted: true });
    // Held, not silently withdrawn — no rank change without confirmation.
    expect(anchorNow()).toEqual(completedAnchor);
  });

  it('recount reopens and withdraws the anchor once fewer than ten remain', () => {
    const games = tenMatches();
    const preRun = anchor();
    const { provider, history, anchorNow } = harness(games, preRun);
    provider.startPlacementRun({ ...track, fromMatchId: 'm-1' });
    provider.completePlacementRun({ ...track, tier: 'Platinum', division: 2 });

    history.splice(history.findIndex((x) => x.matchId === 'm-5'), 1);
    const [summary] = provider.recountPlacementRun(track);
    expect(summary).toMatchObject({ counted: 9, completed: false, drifted: false });
    // The ANCHOR is the thing withdrawn. Asserting on `currentRank` here would
    // be wrong twice over: a match was deleted, so the replayed rank legitimately
    // differs from before, and this harness calls `currentRank` without the
    // open-run suppression the dashboard threads in.
    expect(anchorNow()).toEqual(preRun);
  });

  it('recount only re-baselines when ten still count', () => {
    const games = tenMatches();
    const { provider, history, anchorNow } = harness(games, anchor());
    provider.startPlacementRun({ ...track, fromMatchId: 'm-1' });
    provider.completePlacementRun({ ...track, tier: 'Platinum', division: 2 });
    const completedAnchor = anchorNow();

    // Swap one match for another on the same track — still ten.
    history.splice(history.findIndex((x) => x.matchId === 'm-5'), 1);
    history.push(g(11, { srDelta: 20 }));
    const [summary] = provider.recountPlacementRun(track);
    expect(summary).toMatchObject({ counted: 10, completed: true, drifted: false });
    expect(anchorNow()).toEqual(completedAnchor);
  });

  it('recount is a no-op for an open run', () => {
    const { provider } = harness(tenMatches().slice(0, 3), anchor());
    provider.startPlacementRun({ ...track, fromMatchId: 'm-1' });
    const [summary] = provider.recountPlacementRun(track);
    expect(summary).toMatchObject({ counted: 3, completed: false });
  });
});
