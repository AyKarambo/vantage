import { describe, it, expect, vi } from 'vitest';
import { createDataProvider, type DataProviderDeps } from '../src/main/dataProvider';
import type { AppConfig } from '../src/main/config';

/**
 * Account renames and deletes must carry PLACEMENT RUNS, not just rank anchors.
 *
 * Runs are keyed by the same `${account}::${role}` as anchors, so moving one
 * without the other orphans the run under a name nothing reads any more. This
 * became load-bearing when placement runs started being offered automatically
 * (issue #200): an auto-started run frequently sits on a raw, not-yet-labelled
 * BattleTag — exactly the account a player is about to rename.
 *
 * `PlacementStore.relabel` / `removeAccount` already existed and were already
 * unit-tested; they simply had no production call site.
 */

function harness() {
  const placements = {
    allRuns: () => [],
    getRun: () => undefined,
    setRun: vi.fn(),
    removeRun: vi.fn(),
    declinedFor: () => [],
    addDeclined: vi.fn(),
    relabel: vi.fn(() => 0),
    removeAccount: vi.fn(() => 0),
  };
  const rankAnchors = {
    all: () => [], get: () => undefined, map: () => ({}), set: vi.fn(),
    remove: vi.fn(), relabel: vi.fn(() => 0), removeAccount: vi.fn(() => 0),
  };
  const history = {
    count: () => 0, all: () => [],
    relabelAccount: vi.fn(), deleteByAccount: vi.fn(),
  };
  let accounts: Record<string, string> = {};
  const deps = {
    history, rankAnchors, placements,
    getConfig: () => ({ accounts } as unknown as AppConfig),
    persistAccounts: (next: Record<string, string>) => { accounts = next; },
  } as unknown as DataProviderDeps;
  return { provider: createDataProvider(deps), placements, rankAnchors, setAccounts: (a: Record<string, string>) => { accounts = a; } };
}

describe('accounts — placement runs follow the account', () => {
  it('renaming a configured account relabels its runs alongside its anchors', () => {
    const { provider, placements, rankAnchors, setAccounts } = harness();
    setAccounts({ 'Player#1234': 'Old' });

    // `previousBattleTag` is what identifies this as a rename — without it the
    // provider has no old label to cascade from.
    provider.saveAccount({ battleTag: 'Player#1234', label: 'New', previousBattleTag: 'Player#1234' });

    expect(rankAnchors.relabel).toHaveBeenCalledWith('Old', 'New');
    expect(placements.relabel).toHaveBeenCalledWith('Old', 'New');
  });

  it('labelling a detected raw BattleTag moves its runs onto the new label', () => {
    // The case auto-started runs land in: a live match on an unmapped account
    // is stored under the raw tag, so the run is keyed to it too.
    const { provider, placements, rankAnchors } = harness();

    provider.saveAccount({ battleTag: 'Rando#4521', label: 'Smurf' });

    expect(rankAnchors.relabel).toHaveBeenCalledWith('Rando#4521', 'Smurf');
    expect(placements.relabel).toHaveBeenCalledWith('Rando#4521', 'Smurf');
  });

  it('deleting a detected account removes its runs alongside its anchors', () => {
    const { provider, placements, rankAnchors } = harness();

    provider.deleteDetectedAccount('Rando#4521');

    expect(rankAnchors.removeAccount).toHaveBeenCalledWith('Rando#4521');
    expect(placements.removeAccount).toHaveBeenCalledWith('Rando#4521');
  });
});
