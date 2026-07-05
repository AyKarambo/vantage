import { describe, it, expect, vi } from 'vitest';
import { createDataProvider, type DataProviderDeps } from '../src/main/dataProvider';
import { NOTION_IMPROVEMENT_TARGET_ID } from '../src/notion/notionImporter';
import type { GameRecord } from '../src/core/analytics';
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
 * (so `all` reflects real state and `skipped` is real) plus an upserting target
 * store. `import` returns the same rows each call — imports are full re-scans.
 */
function harness(games: GameRecord[], failed = 0) {
  const stored: GameRecord[] = [];
  const targets: AuthoredTarget[] = [];
  const addTarget = vi.fn((t: AuthoredTarget) => {
    const i = targets.findIndex((x) => x.id === t.id);
    if (i >= 0) targets[i] = t; else targets.push(t);
    return t;
  });
  const removeTarget = (id: string) => {
    const i = targets.findIndex((t) => t.id === id);
    if (i >= 0) targets.splice(i, 1);
  };
  const deps = {
    notion: { import: async () => ({ games, failed }) },
    history: {
      all: () => [...stored],
      addMany: (gs: GameRecord[]) => {
        let imported = 0;
        for (const g of gs) {
          if (!stored.some((s) => s.matchId === g.matchId)) { stored.push(g); imported++; }
        }
        return { imported, skipped: gs.length - imported };
      },
    },
    manual: { targets: () => [...targets], addTarget },
  } as unknown as DataProviderDeps;
  return { provider: createDataProvider(deps), addTarget, targets, removeTarget };
}

describe('importNotion — seeding the imported improvement target', () => {
  it('seeds the target on the first import that carries graded games', async () => {
    const { provider, addTarget, targets } = harness([gradedGame('m1')]);
    const res = await provider.importNotion();
    expect(res).toEqual({ imported: 1, skipped: 0, failed: 0 });
    expect(targets.map((t) => t.id)).toEqual([NOTION_IMPROVEMENT_TARGET_ID]);
    expect(addTarget).toHaveBeenCalledTimes(1);
  });

  it('does not seed when no imported game carries an improvement grade', async () => {
    const { provider, addTarget, targets } = harness([plainGame('m1')]);
    await provider.importNotion();
    expect(targets).toHaveLength(0);
    expect(addTarget).not.toHaveBeenCalled();
  });

  it('is idempotent — a second import neither duplicates nor resets the target', async () => {
    const { provider, addTarget, targets } = harness([gradedGame('m1')]);
    await provider.importNotion();
    const createdAt = targets[0].createdAt;
    await provider.importNotion();
    expect(targets).toHaveLength(1);
    expect(targets[0].createdAt).toBe(createdAt);
    expect(addTarget).toHaveBeenCalledTimes(1);
  });

  it('does not resurrect the target after the user deletes it and re-imports', async () => {
    const { provider, addTarget, targets, removeTarget } = harness([gradedGame('m1')]);
    await provider.importNotion(); // seeds it
    removeTarget(NOTION_IMPROVEMENT_TARGET_ID); // user deletes the generic target
    await provider.importNotion(); // re-import must NOT bring it back
    expect(targets).toHaveLength(0);
    expect(addTarget).toHaveBeenCalledTimes(1);
  });

  it('surfaces skipped (dedupe) and failed counts from the import', async () => {
    const { provider } = harness([gradedGame('m1')], 3);
    const first = await provider.importNotion();
    expect(first).toEqual({ imported: 1, skipped: 0, failed: 3 });
    const second = await provider.importNotion(); // same row → deduped
    expect(second).toEqual({ imported: 0, skipped: 1, failed: 3 });
  });
});
