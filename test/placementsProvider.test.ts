import { describe, it, expect } from 'vitest';
import { createDataProvider, type DataProviderDeps } from '../src/main/dataProvider';
import { currentRank, rankKey, type RankAnchor, type RankAnchorMap } from '../src/core/rank';
import { suppressedMatchIds, type PlacementRun } from '../src/core/placements';
import { DEFAULT_MASTER_DATA } from '../src/core/masterData';
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
      addDeclined: (a: string, r: Role, seasonStart: number) => {
        const key = rankKey(a, r);
        const list = declined[key] ?? [];
        if (!list.includes(seasonStart)) declined[key] = [...list, seasonStart];
      },
      relabel: () => 0,
      removeAccount: () => 0,
    },
    masterDataStore: { all: () => ({ heroes: {}, maps: {}, seasons: {} }) },
    getConfig: () => ({ accounts: {} }),
  } as unknown as DataProviderDeps;

  const provider = createDataProvider(deps);
  const rankNow = () => currentRank(history, deps.rankAnchors.map(), ACCOUNT, ROLE);
  // What every rank SURFACE renders while a run is open: the same read-time mask
  // the dashboard applies. `rankNow` is the unsuppressed view — the two must
  // agree whenever no run is open, and only the masked one is meaningful while
  // one is.
  const rankShown = () => currentRank(
    history, deps.rankAnchors.map(), ACCOUNT, ROLE, undefined,
    suppressedMatchIds(history, Object.values(runs)),
  );
  const anchorNow = () => anchors[rankKey(ACCOUNT, ROLE)];
  const runNow = (): PlacementRun | undefined => runs[rankKey(ACCOUNT, ROLE)];
  return { provider, rankNow, rankShown, anchorNow, runNow, runs, history, recorded: () => recordedGames };
}

/** Ten placement matches, each carrying a delta that must stay dormant while the run is open. */
const tenMatches = () => Array.from({ length: 10 }, (_, i) => g(i + 1, { srDelta: 20 }));

/**
 * `n` competitive matches on the tracked (account, role) inside the CURRENT
 * season, one minute apart. The new-track offer counts only matches since the
 * season start, so the `T0`-based `g()` fixtures above (Nov 2023, before every
 * shipped season) are all "last season" to it and raise nothing.
 *
 * Derived from the same table the provider reads rather than hard-coded, so
 * these keep working as the calendar moves — the defensive style the reset
 * test above already uses.
 */
const currentSeasonStart = (): number => {
  const seasons = [...DEFAULT_MASTER_DATA.seasons].sort((a, b) => a.start - b.start);
  return seasons.filter((s) => s.start <= Date.now()).pop()!.start;
};
const thisSeason = (n: number): GameRecord[] => {
  const base = currentSeasonStart() + MINUTE;
  return Array.from({ length: n }, (_, i) => g(0, {
    matchId: `s-${i}`,
    timestamp: base + i * MINUTE,
    srDelta: 20,
  }));
};

const track = { account: ACCOUNT, role: ROLE };

describe('placement runs — start and complete', () => {
  it('completion anchors at the last match in the run\'s window, not the wall clock', () => {
    const games = tenMatches();
    const { provider, anchorNow } = harness(games, anchor());
    provider.startPlacementRun({ ...track, fromMatchId: 'm-1' });
    provider.completePlacementRun({ ...track, tier: 'Platinum', division: 2 });
    // With no surplus the window IS the counted ten, so this is the 10th match's
    // timestamp — competitiveComps (strictly after the anchor) then excludes
    // every placement match from the rank arithmetic.
    expect(anchorNow().setAt).toBe(games[9].timestamp);
    expect(anchorNow()).toMatchObject({ tier: 'Platinum', division: 2, progressPct: 0 });
  });

  it('anchors past the tenth match when the player kept queueing before confirming', () => {
    // Thirteen matches inside the window: the entered rank is what the game shows
    // NOW, which already reflects m-11..m-13, so the anchor must sit after them.
    const games = [...tenMatches(), g(11, { srDelta: 20 }), g(12, { srDelta: 20 }), g(13, { srDelta: 20 })];
    const { provider, anchorNow } = harness(games, anchor());
    provider.startPlacementRun({ ...track, fromMatchId: 'm-1' });
    provider.completePlacementRun({ ...track, tier: 'Platinum', division: 2 });
    expect(anchorNow().setAt).toBe(games[12].timestamp);
  });

  it('a surplus match\'s ±% is absorbed by the confirmed rank, never applied twice', () => {
    // The double-count regression test. Anchoring at the tenth match instead of
    // the last would re-apply m-11..m-13's +20 on top of a rank that already
    // includes them — measured at a full division of overshoot.
    const games = [...tenMatches(), g(11, { srDelta: 20 }), g(12, { srDelta: 20 }), g(13, { srDelta: 20 })];
    const { provider, rankNow } = harness(games, anchor());
    provider.startPlacementRun({ ...track, fromMatchId: 'm-1' });
    provider.completePlacementRun({ ...track, tier: 'Platinum', division: 2, progressPct: 60 });
    expect(rankNow()).toMatchObject({ tier: 'Platinum', division: 2, progressPct: 60 });
  });

  it('a surplus match\'s ±% stays dormant while the run still awaits its rank', () => {
    const games = [...tenMatches(), g(11, { srDelta: 20 }), g(12, { srDelta: 20 })];
    const { provider, rankShown } = harness(games, anchor());
    const [summary] = provider.startPlacementRun({ ...track, fromMatchId: 'm-1' });
    expect(summary).toMatchObject({ counted: 10, completed: false, awaitingRank: true });
    // Suppression covers the whole window, so nothing reaches the PRE-run anchor.
    expect(rankShown()).toMatchObject({ tier: 'Gold', division: 3, progressPct: 40 });
  });

  it('getRanks() agrees with what the rank surfaces show while a run is open', () => {
    const games = [...tenMatches(), g(11, { srDelta: 20 }), g(12, { srDelta: 20 })];
    const { provider, rankShown } = harness(games, anchor());
    provider.startPlacementRun({ ...track, fromMatchId: 'm-1' });
    const [summary] = provider.getRanks();
    const shown = rankShown();
    // Without suppression here, getRanks() reported a rank built from matches the
    // Overview KPI is deliberately holding back — the same number in two places
    // disagreeing. This also backs Settings → Accounts and the MCP ranks tool.
    expect(summary).toMatchObject({
      tier: shown!.tier, division: shown!.division, progressPct: shown!.progressPct,
    });
  });

  it('cancelling an awaiting run hands the surplus matches\' ±% back, exactly as if no run had existed', () => {
    const games = [...tenMatches(), g(11, { srDelta: 20 }), g(12, { srDelta: -10 })];
    const cancelled = harness(games, anchor());
    cancelled.provider.startPlacementRun({ ...track, fromMatchId: 'm-1' });
    cancelled.provider.cancelPlacementRun({ ...track });
    // The oracle for "exact undo": a harness that never had a run at all. Asserting
    // against that rather than a hardcoded rank is the point — cancel is defined as
    // a byte-identical restoration, including the surplus matches' deltas.
    const untouched = harness(games, anchor());
    expect(cancelled.rankNow()).toEqual(untouched.rankNow());
    expect(cancelled.anchorNow()).toMatchObject({ tier: 'Gold', division: 3, progressPct: 40 });
  });

  it('reset on an awaiting run leaves the surplus deltas untouched and writes no match', () => {
    const games = [...tenMatches(), g(11, { srDelta: 20 })];
    const { provider, history, recorded } = harness(games, anchor());
    provider.startPlacementRun({ ...track, fromMatchId: 'm-1' });
    const [summary] = provider.resetPlacementRun({ ...track });
    expect(summary).toMatchObject({ counted: 10, completed: false, awaitingRank: true });
    expect(history.find((x) => x.matchId === 'm-11')?.srDelta).toBe(20);
    expect(recorded()).toBe(0);
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

describe('placement runs — the offer', () => {
  /**
   * Whether the CURRENT season is a reset is settled by `shouldOfferRun` and
   * tested there; it depends on the wall clock, which this provider reads
   * directly, so the cases pinned here are the wall-clock-independent ones —
   * exactly the wiring the offer adds on top.
   */
  it('never offers while a run already exists', () => {
    const { provider } = harness(tenMatches(), anchor());
    provider.startPlacementRun({ ...track, fromMatchId: 'm-1' });
    expect(provider.placementOffer(track)).toBeNull();
  });

  it('never offers for a completed run either', () => {
    const { provider } = harness(tenMatches(), anchor());
    provider.startPlacementRun({ ...track, fromMatchId: 'm-1' });
    provider.completePlacementRun({ ...track, tier: 'Platinum', division: 2 });
    expect(provider.placementOffer(track)).toBeNull();
  });

  it('offers exactly when the shipped current season is a reset, and a decline silences it', () => {
    const { provider } = harness(tenMatches(), anchor());
    // Derived from the same table the provider reads, so this asserts in both
    // directions instead of quietly skipping once the calendar moves past the
    // last flagged reset.
    const seasons = [...DEFAULT_MASTER_DATA.seasons].sort((a, b) => a.start - b.start);
    const current = seasons.filter((s) => s.start <= Date.now()).pop();
    const offer = provider.placementOffer(track);

    if (!current?.isReset) {
      expect(offer).toBeNull();
      return;
    }
    expect(offer).toMatchObject({ account: ACCOUNT, role: ROLE, seasonStart: current.start });
    provider.declinePlacementRun({ ...track, seasonStart: current.start });
    expect(provider.placementOffer(track)).toBeNull();
  });

  it('does not offer a new-track run over matches from a previous season', () => {
    // The harness's T0 (Nov 2023) predates every shipped season start, so these
    // ten matches are all "last season" as far as the offer is concerned. The
    // new-track rule counts only matches inside the CURRENT season, which keeps
    // a run's startedAt in the same season that raised it — an unbounded
    // backdate would reach months back, suppress that old ±% out of every rank
    // surface, and let completion re-anchor over historical rank.
    const { provider } = harness(tenMatches());
    expect(provider.placementOffer(track)).toBeNull();
  });

  it('offers a brand-new track a run, backdated to its first match this season', () => {
    const { provider } = harness(thisSeason(3));
    expect(provider.placementOffer(track)).toMatchObject({
      account: ACCOUNT, role: ROLE, reason: 'new-track', fromMatchId: 's-0', backdatedCount: 3,
    });
  });

  it('accepting a new-track offer counts the matches already played (issue #200: 3/10, not 2/10)', () => {
    // THE regression test for the reported symptom. Before the fix the offer
    // carried no fromMatchId, `startPlacementRun` stamped Date.now(), and
    // `countedMatches` (timestamp >= startedAt) excluded every match that had
    // already happened — including the one that raised the prompt.
    const { provider } = harness(thisSeason(4));
    const offer = provider.placementOffer(track);
    expect(offer).not.toBeNull();
    provider.startPlacementRun({ ...track, ...(offer!.fromMatchId ? { fromMatchId: offer!.fromMatchId } : {}) });
    expect(provider.getPlacements()[0]).toMatchObject({ counted: 4 });
  });

  it('starts now, with no backdate, once more than a full run has been played', () => {
    // Past ten claimable matches there is no honest backdate: starting eleven
    // back would count only the first ten and quietly drop the very match that
    // raised the offer. Still offered — just without the backdate, and the
    // prompt says so via backdatedCount: 0.
    const { provider } = harness(thisSeason(12));
    expect(provider.placementOffer(track)).toMatchObject({ reason: 'new-track', backdatedCount: 0 });
    expect(provider.placementOffer(track)?.fromMatchId).toBeUndefined();
  });

  it('never offers a new-track run for the Unknown bucket', () => {
    // A match with no captured or mapped BattleTag lands there; asking
    // "placements for Tank on Unknown?" keys a run to a label about to be
    // replaced.
    const games = thisSeason(3).map((m) => ({ ...m, account: 'Unknown' }));
    const { provider } = harness(games);
    expect(provider.placementOffer({ account: 'Unknown', role: ROLE })).toBeNull();
  });

  it('a decline silences the new-track offer for the season', () => {
    // The season-keyed ledger covers the new-track case with no schema change.
    const { provider } = harness(thisSeason(2));
    const offer = provider.placementOffer(track);
    expect(offer).not.toBeNull();
    provider.declinePlacementRun({ ...track, seasonStart: offer!.seasonStart });
    expect(provider.placementOffer(track)).toBeNull();
  });

  it('stops offering once the track has an anchor, however it got one', () => {
    const { provider } = harness(thisSeason(2));
    expect(provider.placementOffer(track)).not.toBeNull();
    provider.setRankAnchor({ ...track, tier: 'Gold', division: 3, progressPct: 40 });
    expect(provider.placementOffer(track)).toBeNull();
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

describe('placement runs — awaiting rank', () => {
  it('is true once a run counts its full target but the revealed rank is not confirmed yet', () => {
    const { provider } = harness(tenMatches(), anchor());
    provider.startPlacementRun({ ...track, fromMatchId: 'm-1' });
    const [summary] = provider.getPlacements();
    expect(summary).toMatchObject({ counted: 10, target: 10, completed: false, awaitingRank: true });
  });

  it('is false mid-run, when there is nothing to confirm yet', () => {
    const { provider } = harness(tenMatches().slice(0, 4), anchor());
    provider.startPlacementRun({ ...track, fromMatchId: 'm-1' });
    const [summary] = provider.getPlacements();
    expect(summary).toMatchObject({ counted: 4, target: 10, awaitingRank: false });
  });

  it('is false again once the run is completed — confirmation resolves it', () => {
    const { provider } = harness(tenMatches(), anchor());
    provider.startPlacementRun({ ...track, fromMatchId: 'm-1' });
    const [summary] = provider.completePlacementRun({ ...track, tier: 'Platinum', division: 2 });
    expect(summary).toMatchObject({ completed: true, awaitingRank: false });
  });

  it('backdating a run start onto ten already-logged matches reports awaitingRank immediately (AC2)', () => {
    const games = tenMatches();
    const { provider } = harness(games, anchor());
    // fromMatchId backdates startedAt to m-1's own timestamp, which already has
    // nine later competitive matches on the track sitting in history — the run
    // reaches its target the instant it starts, with no new match required.
    const [summary] = provider.startPlacementRun({ ...track, fromMatchId: 'm-1' });
    expect(summary).toMatchObject({ counted: 10, target: 10, completed: false, awaitingRank: true });
  });

  it('rebuilding summaries never auto-resolves a run awaiting rank (AC10)', () => {
    const { provider, anchorNow } = harness(tenMatches(), anchor());
    provider.startPlacementRun({ ...track, fromMatchId: 'm-1' });
    const anchorBefore = anchorNow();

    // Recomputing the summary (as a fresh dashboard/getPlacements call would)
    // must be idempotent: still open, still awaiting, anchor untouched. Nothing
    // short of an explicit completePlacementRun may resolve it.
    const first = provider.getPlacements()[0];
    const second = provider.getPlacements()[0];
    expect(first).toMatchObject({ completed: false, awaitingRank: true });
    expect(second).toMatchObject({ completed: false, awaitingRank: true });
    expect(anchorNow()).toEqual(anchorBefore);
  });
});

describe('placement runs — moving where a run starts', () => {
  it('re-pointing an open run at an earlier match keeps its predictions and its pre-run anchor', () => {
    // "Change start match…" is a correction to WHERE the run begins (started
    // late, or on the wrong game) — not a decision to throw away the predicted
    // ranks already entered, and not a second chance to snapshot the anchor.
    // `resetPlacementRun` is the action that means "replay from scratch".
    const games = tenMatches();
    const { provider, runNow } = harness(games, anchor());
    provider.startPlacementRun({ ...track, fromMatchId: 'm-5' });
    provider.setPlacementPrediction({ ...track, matchId: 'm-6', prediction: { tier: 'Platinum', division: 2 } });
    const before = runNow()!;

    provider.startPlacementRun({ ...track, fromMatchId: 'm-2' });

    const after = runNow()!;
    expect(after.startedAt).toBe(games.find((m) => m.matchId === 'm-2')!.timestamp);
    expect(after.predictions).toEqual(before.predictions);
    expect(after.preRunAnchor).toEqual(before.preRunAnchor);
  });

  it('resetting a run still clears its predictions', () => {
    const { provider, runNow } = harness(tenMatches(), anchor());
    provider.startPlacementRun({ ...track, fromMatchId: 'm-1' });
    provider.setPlacementPrediction({ ...track, matchId: 'm-2', prediction: { tier: 'Platinum', division: 2 } });
    provider.resetPlacementRun(track);
    expect(runNow()!.predictions).toEqual({});
  });
});
