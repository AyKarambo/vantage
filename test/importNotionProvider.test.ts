import { describe, it, expect, vi } from 'vitest';
import { createDataProvider, type DataProviderDeps } from '../src/main/dataProvider';
import { NOTION_IMPROVEMENT_TARGET_ID } from '../src/notion/notionImporter';
import type { GameRecord, MatchReview } from '../src/core/analytics';
import type { AuthoredTarget } from '../src/core/targets';

function gradedGame(matchId: string): GameRecord {
  return {
    matchId, timestamp: 1, account: 'You', role: 'damage', map: 'Ilios', result: 'Win',
    gameType: 'Competitive', source: 'manual', heroes: [],
    review: { at: 1, grades: { [NOTION_IMPROVEMENT_TARGET_ID]: 'hit' }, flags: {} },
  };
}
function plainGame(matchId: string): GameRecord {
  return {
    matchId, timestamp: 1, account: 'You', role: 'damage', map: 'Ilios', result: 'Win',
    gameType: 'Competitive', source: 'manual', heroes: [],
  };
}

/**
 * Minimal but faithful harness: an in-memory history that dedupes by matchId
 * on `addMany` and merges (local-wins) on `mergeImported`, so `all` reflects
 * real state and both counters are real. `import` returns the same rows each
 * call — imports are full re-scans.
 */
function harness(
  games: GameRecord[], failed = 0, initialAccounts: Record<string, string> = { You: 'You' }, duplicates = 0,
) {
  const stored: GameRecord[] = [];
  const targets: AuthoredTarget[] = [];
  let accounts: Record<string, string> = { ...initialAccounts };
  const addTarget = vi.fn((t: AuthoredTarget) => {
    const i = targets.findIndex((x) => x.id === t.id);
    if (i >= 0) targets[i] = t; else targets.push(t);
    return t;
  });
  const persistAccounts = vi.fn((a: Record<string, string>) => { accounts = a; });
  const clearExports = vi.fn();
  const deps = {
    notion: { import: async () => ({ games, failed, duplicates }), clearExports },
    history: {
      all: () => [...stored],
      addMany: (gs: GameRecord[]) => {
        let imported = 0;
        for (const g of gs) {
          if (!stored.some((s) => s.matchId === g.matchId)) { stored.push(g); imported++; }
        }
        return { imported, skipped: gs.length - imported };
      },
      // Faithful-enough stand-in for the real `HistoryStore.mergeImported`:
      // local review/mental always wins wholesale; a bookkeeping grade or the
      // whole mental record is adopted only when the local match has none.
      mergeImported: (entries: GameRecord[]) => {
        let merged = 0;
        let skipped = 0;
        for (const imported of entries) {
          const local = stored.find((s) => s.matchId === imported.matchId);
          if (!local) { skipped++; continue; }
          let changed = false;
          const importedGrade = imported.review?.grades[NOTION_IMPROVEMENT_TARGET_ID];
          if (local.review === undefined && importedGrade !== undefined) {
            local.review = { at: imported.review!.at, grades: { [NOTION_IMPROVEMENT_TARGET_ID]: importedGrade }, flags: {} } as MatchReview;
            changed = true;
          }
          if (local.mental === undefined && imported.mental !== undefined) {
            local.mental = imported.mental;
            changed = true;
          }
          if (changed) merged++; else skipped++;
        }
        return { merged, skipped };
      },
      removeImported: () => {
        const removed = stored.filter((g) => g.importedAt != null);
        for (const r of removed) stored.splice(stored.indexOf(r), 1);
        return removed;
      },
    },
    manual: { targets: () => [...targets], addTarget },
    getConfig: () => ({ accounts }),
    persistAccounts,
  } as unknown as DataProviderDeps;
  return {
    provider: createDataProvider(deps), addTarget, targets, persistAccounts, clearExports,
    getAccounts: () => accounts, getStored: () => stored,
  };
}

/** A game with an explicit account label (Notion's Account column value). */
function accountGame(matchId: string, account: string): GameRecord {
  return {
    matchId, timestamp: 1, account, role: 'damage', map: 'Ilios', result: 'Win',
    gameType: 'Competitive', source: 'manual', heroes: [],
  };
}

describe('importNotion — no synthetic target seeding (B2)', () => {
  it('never seeds an AuthoredTarget for a brand-new graded row', async () => {
    const { provider, addTarget, targets } = harness([gradedGame('m1')]);
    const res = await provider.importNotion();
    expect(res).toEqual({ imported: 1, skipped: 0, failed: 0 });
    expect(targets).toHaveLength(0);
    expect(addTarget).not.toHaveBeenCalled();
  });

  it('never seeds when no imported game carries an improvement grade', async () => {
    const { provider, addTarget, targets } = harness([plainGame('m1')]);
    await provider.importNotion();
    expect(targets).toHaveLength(0);
    expect(addTarget).not.toHaveBeenCalled();
  });

  it('never seeds on a re-import of the same graded row', async () => {
    const { provider, addTarget, targets } = harness([gradedGame('m1')]);
    await provider.importNotion();
    await provider.importNotion();
    expect(targets).toHaveLength(0);
    expect(addTarget).not.toHaveBeenCalled();
  });

  it('never seeds when merging a grade onto an existing local match', async () => {
    const { provider, addTarget, targets, getStored } = harness([gradedGame('m1')]);
    getStored().push(plainGame('m1')); // already tracked locally, no review
    await provider.importNotion();
    expect(targets).toHaveLength(0);
    expect(addTarget).not.toHaveBeenCalled();
  });
});

describe('importNotion — merge on re-import (B1)', () => {
  it('existing local match without review + Notion grade → local gains the grade, no duplicate, not pending', async () => {
    const { provider, getStored } = harness([gradedGame('m1')]);
    getStored().push(plainGame('m1'));
    const res = await provider.importNotion();
    expect(res.imported).toBe(0); // not a new row
    expect(res.skipped).toBe(0); // the merge changed something, so not counted as skipped
    expect(res.merged).toBe(1); // surfaced on the result (finding: merge-only imports must report a nonzero count)
    expect(getStored()).toHaveLength(1); // no duplicate
    expect(getStored()[0].review?.grades[NOTION_IMPROVEMENT_TARGET_ID]).toBe('hit');
  });

  it('a merge-only import (0 new rows) still reports a nonzero merged count, not just 0 imported', async () => {
    const { provider, getStored } = harness([gradedGame('m1')]);
    getStored().push(plainGame('m1')); // already tracked locally — nothing new to import
    const res = await provider.importNotion();
    expect(res.imported).toBe(0);
    expect(res.merged).toBe(1);
  });

  it('omits merged from the result when nothing was merged (brand-new row only)', async () => {
    const { provider } = harness([gradedGame('m1')]);
    const res = await provider.importNotion();
    expect(res.imported).toBe(1);
    expect(res.merged).toBeUndefined();
  });

  it('Notion row with a grade and no local counterpart → arrives as a new already-reviewed row', async () => {
    const { provider, getStored } = harness([gradedGame('m1')]);
    const res = await provider.importNotion();
    expect(res.imported).toBe(1);
    expect(getStored()[0].review?.grades[NOTION_IMPROVEMENT_TARGET_ID]).toBe('hit');
  });

  it('local match already reviewed by the user → import leaves the local review unchanged', async () => {
    const { provider, getStored } = harness([gradedGame('m1')]);
    const localReview: MatchReview = { at: 500, grades: { 't-1': 'missed' }, flags: {} };
    getStored().push({ ...plainGame('m1'), review: localReview });
    await provider.importNotion();
    expect(getStored()[0].review).toEqual(localReview);
  });

  it('local mental with tilt unchecked + Notion Tilt checked → local flag stays unchecked (local wins)', async () => {
    const importedWithMental: GameRecord = { ...plainGame('m1'), mental: { tilt: true } };
    const { provider, getStored } = harness([importedWithMental]);
    getStored().push({ ...plainGame('m1'), mental: { tilt: false } });
    await provider.importNotion();
    expect(getStored()[0].mental).toEqual({ tilt: false });
  });

  it('is idempotent — a second import of the same rows neither duplicates nor re-merges', async () => {
    const { provider, getStored } = harness([gradedGame('m1')]);
    await provider.importNotion();
    await provider.importNotion();
    expect(getStored()).toHaveLength(1);
  });
});

describe('importNotion — duplicates passthrough', () => {
  it('surfaces the runtime-reported duplicate count on the result', async () => {
    const { provider } = harness([gradedGame('m1')], 0, { You: 'You' }, 2);
    const res = await provider.importNotion();
    expect(res.duplicates).toBe(2);
  });

  it('omits duplicates from the result when the runtime reports none', async () => {
    const { provider } = harness([gradedGame('m1')], 0, { You: 'You' }, 0);
    const res = await provider.importNotion();
    expect(res.duplicates).toBeUndefined();
  });
});

describe('importNotion — seeding imported accounts', () => {
  it('registers a name-only entry for each imported account label not already known', async () => {
    const { provider, getAccounts } = harness(
      [accountGame('m1', 'Karambo'), accountGame('m2', 'BobRoss'), accountGame('m3', 'Karambo')],
      0,
      {}, // no accounts configured yet
    );
    const res = await provider.importNotion();
    expect(res.accountsAdded).toBe(2);
    expect(getAccounts()).toEqual({ Karambo: 'Karambo', BobRoss: 'BobRoss' });
  });

  it('does not duplicate an account already mapped (case-insensitively, e.g. via a battleTag)', async () => {
    const { provider, getAccounts, persistAccounts } = harness(
      [accountGame('m1', 'Karambo')],
      0,
      { 'karambo#21442': 'karambo' }, // already mapped under a real battleTag
    );
    const res = await provider.importNotion();
    expect(res.accountsAdded).toBeUndefined(); // nothing new
    expect(persistAccounts).not.toHaveBeenCalled();
    expect(getAccounts()).toEqual({ 'karambo#21442': 'karambo' });
  });

  it('is idempotent — a second import adds no further accounts', async () => {
    const { provider, persistAccounts } = harness([accountGame('m1', 'Baranbo')], 0, {});
    await provider.importNotion();
    await provider.importNotion();
    expect(persistAccounts).toHaveBeenCalledTimes(1);
  });
});

describe('importNotion — flagging + wiping imported matches', () => {
  it('stamps every brand-new imported game with importedAt so it can be identified', async () => {
    const { provider, getStored } = harness([accountGame('m1', 'Karambo'), accountGame('m2', 'BobRoss')]);
    await provider.importNotion();
    expect(getStored().every((g) => typeof g.importedAt === 'number')).toBe(true);
  });

  it('does not stamp importedAt on a merged (already-local) match', async () => {
    const { provider, getStored } = harness([gradedGame('m1')]);
    getStored().push(plainGame('m1'));
    await provider.importNotion();
    expect(getStored()[0].importedAt).toBeUndefined();
  });

  it('deleteImportedMatches removes only the imported games, reports the count, and clears their export ledger entries', async () => {
    const { provider, getStored, clearExports } = harness([gradedGame('m1'), plainGame('m2')]);
    await provider.importNotion();
    // A hand-logged / live game (no importedAt) that must survive the wipe.
    getStored().push({ ...plainGame('live'), importedAt: undefined });
    const res = provider.deleteImportedMatches();
    expect(res).toEqual({ deleted: 2 });
    expect(getStored().map((g) => g.matchId)).toEqual(['live']);
    expect(clearExports).toHaveBeenCalledTimes(1);
    expect(clearExports.mock.calls[0][0].sort()).toEqual(['m1', 'm2']);
  });
});
