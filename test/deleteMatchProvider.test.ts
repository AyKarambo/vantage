import { describe, it, expect, vi } from 'vitest';
import { createDataProvider, type DataProviderDeps } from '../src/main/dataProvider';
import type { GameRecord } from '../src/core/analytics';

function game(matchId: string, patch: Partial<GameRecord> = {}): GameRecord {
  return {
    matchId, timestamp: 1, account: 'You', role: 'damage', map: 'Ilios', result: 'Win',
    gameType: 'Competitive', heroes: [], ...patch,
  };
}

/**
 * Minimal but faithful harness: an in-memory history whose `deleteMatch`
 * reports whether a row actually went, so the provider's early return on an
 * unknown id is exercised for real rather than stubbed true.
 */
function harness(games: GameRecord[]) {
  const stored = [...games];
  const clearExports = vi.fn();
  const dismissPending = vi.fn(() => false);
  const removeAccount = vi.fn();
  const deps = {
    history: {
      all: () => [...stored],
      count: () => stored.length,
      deleteMatch: (matchId: string) => {
        const i = stored.findIndex((g) => g.matchId === matchId);
        if (i < 0) return undefined;
        return stored.splice(i, 1)[0];
      },
      add: (g: GameRecord) => {
        if (stored.some((s) => s.matchId === g.matchId)) return false;
        stored.push(g);
        return true;
      },
    },
    notion: { clearExports },
    rankAnchors: { removeAccount },
    dismissPending,
    getConfig: () => ({ accounts: { You: 'You' } }),
  } as unknown as DataProviderDeps;
  return { provider: createDataProvider(deps), clearExports, dismissPending, removeAccount, getStored: () => stored };
}

describe('deleteMatch (provider)', () => {
  it('drops the row and clears only that match from the Notion export ledger', () => {
    const { provider, clearExports, getStored } = harness([game('keep'), game('bogus', { map: 'Unknown' })]);

    expect(provider.deleteMatch('bogus')).toEqual({ deleted: true });

    expect(getStored().map((g) => g.matchId)).toEqual(['keep']);
    expect(clearExports).toHaveBeenCalledTimes(1);
    expect(clearExports).toHaveBeenCalledWith(['bogus']);
  });

  it('reports deleted:false for an unknown id and cascades nothing', () => {
    const { provider, clearExports, dismissPending, getStored } = harness([game('keep')]);

    expect(provider.deleteMatch('never-existed')).toEqual({ deleted: false });

    expect(getStored().map((g) => g.matchId)).toEqual(['keep']);
    // A no-op must not clear a ledger entry or fire a pending-changed push.
    expect(clearExports).not.toHaveBeenCalled();
    expect(dismissPending).not.toHaveBeenCalled();
  });

  it('clears a stray pending row for the same id, through the pipeline dismiss', () => {
    const { provider, dismissPending } = harness([game('dup')]);

    provider.deleteMatch('dup');

    // Goes via deps.dismissPending (not history.removePending) so the
    // `pending-changed` push still fires and Review can't resurrect the match.
    expect(dismissPending).toHaveBeenCalledWith('dup');
  });

  it('never touches rank anchors — they are keyed (account, role), not by match', () => {
    const { provider, removeAccount } = harness([game('a', { srDelta: -25 })]);

    provider.deleteMatch('a');

    // Rank self-corrects because reconstruct sums srDelta over the remaining
    // games. Removing the anchor would throw away a still-true reading.
    expect(removeAccount).not.toHaveBeenCalled();
  });
});

describe('undoDeleteMatch (provider)', () => {
  it('restores the exact record that was deleted, not an approximation', () => {
    const original = game('bogus', {
      map: 'Unknown', result: 'Loss', srDelta: -25, source: 'gep',
      review: { at: 7, grades: { t1: 'hit' }, flags: { tilt: true } },
    });
    const { provider, getStored } = harness([game('keep'), original]);

    provider.deleteMatch('bogus');
    expect(getStored().map((g) => g.matchId)).toEqual(['keep']);

    expect(provider.undoDeleteMatch('bogus')).toEqual({ restored: true });
    // Same id, same provenance, same review — the whole row came back.
    expect(getStored().find((g) => g.matchId === 'bogus')).toEqual(original);
  });

  it('reports restored:false for a match it never deleted', () => {
    const { provider } = harness([game('a')]);

    expect(provider.undoDeleteMatch('a')).toEqual({ restored: false });
  });

  it('is single-use — a second undo of the same match reports false', () => {
    const { provider } = harness([game('a')]);

    provider.deleteMatch('a');
    expect(provider.undoDeleteMatch('a')).toEqual({ restored: true });
    expect(provider.undoDeleteMatch('a')).toEqual({ restored: false });
  });

  it('bounds the buffer, so the oldest delete stops being undoable', () => {
    const many = Array.from({ length: 25 }, (_, i) => game(`m${i}`));
    const { provider } = harness(many);

    for (const g of many) provider.deleteMatch(g.matchId);

    // 25 deletes against a 20-entry buffer: the first five rolled off.
    expect(provider.undoDeleteMatch('m0')).toEqual({ restored: false });
    expect(provider.undoDeleteMatch('m4')).toEqual({ restored: false });
    expect(provider.undoDeleteMatch('m5')).toEqual({ restored: true });
    expect(provider.undoDeleteMatch('m24')).toEqual({ restored: true });
  });

  it('does not rebuild the Notion ledger entry — the exporter re-adopts the page', () => {
    const { provider, clearExports } = harness([game('a')]);

    provider.deleteMatch('a');
    provider.undoDeleteMatch('a');

    // Cleared once by the delete, never re-added. A re-export resolves the
    // existing row through the exporter's index instead of duplicating it.
    expect(clearExports).toHaveBeenCalledTimes(1);
  });
});
