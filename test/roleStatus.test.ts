import { describe, it, expect } from 'vitest';
import {
  ROLE_ORDER,
  ROLE_SHORT,
  accountRoleSummary,
  roleStatus,
} from '../renderer/src/roleStatus';
import { tierCodeOf } from '../src/core/rankDisplay';
import { TIERS } from '../src/core/rank/engine';
import type { PlacementRunSummary, RankSummary } from '../src/shared/contract';

/**
 * roleStatus.ts is pure and DOM-free (strings in, strings out over the shared
 * rankDisplay parts), so it runs directly under the node vitest environment —
 * same pattern as winrateScheme / scrollNav. Covers the per-track status line
 * and the compact per-account summary the Settings → Accounts list shows.
 */

const rank = (p: Partial<RankSummary> & { role: RankSummary['role'] }): RankSummary => ({
  account: 'Main', tier: 'Gold', division: 3, progressPct: 40, protected: false, ...p,
});

const run = (p: Partial<PlacementRunSummary> & { role: PlacementRunSummary['role'] }): PlacementRunSummary => ({
  account: 'Main', counted: 3, target: 10, completed: false, drifted: false, awaitingRank: false, countedMatchIds: [], ...p,
});

describe('roleStatus', () => {
  it('an open run wins over the rank, with the latest prediction as a suffix', () => {
    const s = roleStatus(rank({ role: 'damage' }), run({ role: 'damage', counted: 4, latestPrediction: { tier: 'Platinum', division: 4 } }));
    expect(s).toEqual({ text: 'Placements 4/10 · Platinum 4 (predicted)', tone: 'placement' });
  });

  it('a counted-out run asks for the rank instead of showing its stale guess', () => {
    const s = roleStatus(undefined, run({ role: 'tank', counted: 10, awaitingRank: true, latestPrediction: { tier: 'Gold', division: 1 } }));
    expect(s).toEqual({ text: 'Placements 10/10 · confirm your rank', tone: 'placement' });
  });

  it('a counter alone before any prediction posts', () => {
    expect(roleStatus(undefined, run({ role: 'support', counted: 0 })).text).toBe('Placements 0/10');
  });

  it('a rank alone: label + %, shield only while protected, placed tone on request', () => {
    expect(roleStatus(rank({ role: 'damage' }), undefined)).toEqual({ text: 'Gold 3 · 40%', tone: 'rank' });
    expect(roleStatus(rank({ role: 'damage', progressPct: -11, protected: true }), undefined))
      .toEqual({ text: 'Gold 3 · -11% 🛡', tone: 'rank' });
    expect(roleStatus(rank({ role: 'damage' }), undefined, true).tone).toBe('placed');
  });

  it('nothing tracked reads as empty', () => {
    expect(roleStatus(undefined, undefined)).toEqual({ text: 'No rank yet', tone: 'empty' });
  });
});

describe('tier codes', () => {
  // REPLACES the old three-entry `tierShort` policy (Plat/GM/Champ, everything
  // else passing through on the grounds that "Dia" read worse than the space it
  // saved). There is one short form now, applied only where the layout is
  // genuinely tight — see `core/rankDisplay`.
  it('gives every tier a code, and the chips use it', () => {
    expect(TIERS.map(tierCodeOf)).toEqual(['B', 'S', 'G', 'P', 'E', 'D', 'M', 'GM', 'C']);
  });
});

describe('accountRoleSummary', () => {
  it('walks ROLE_ORDER (Open Queue last) and skips roles the account does not track', () => {
    expect(ROLE_ORDER).toEqual(['tank', 'damage', 'support', 'openQ']);
    const chips = accountRoleSummary('Main', [rank({ role: 'openQ' }), rank({ role: 'tank', tier: 'Silver', division: 1 })], []);
    expect(chips.map((c) => c.role)).toEqual(['tank', 'openQ']);
    expect(chips[0]).toEqual({ role: 'tank', text: 'Tank · S1 · 40%', tone: 'rank' });
    expect(chips[1].text).toBe(`${ROLE_SHORT.openQ} · G3 · 40%`);
  });

  it('shortens every tier and keeps the protection shield', () => {
    const chips = accountRoleSummary('Main', [
      rank({ role: 'damage', tier: 'Grandmaster', division: 4, progressPct: 16 }),
      rank({ role: 'support', tier: 'Platinum', division: 2, progressPct: -8, protected: true }),
    ], []);
    expect(chips.map((c) => c.text)).toEqual(['Dmg · GM4 · 16%', 'Sup · P2 · -8% 🛡']);
  });

  it('an open run shows only its counter — the prediction is left to the modal', () => {
    const chips = accountRoleSummary('Main', [rank({ role: 'damage' })], [
      run({ role: 'damage', counted: 3, latestPrediction: { tier: 'Platinum', division: 4 } }),
    ]);
    expect(chips).toEqual([{ role: 'damage', text: 'Dmg · Placements 3/10', tone: 'placement' }]);
  });

  it('a counted-out run flags that the rank still needs confirming', () => {
    const chips = accountRoleSummary('Main', [], [run({ role: 'tank', counted: 10, awaitingRank: true })]);
    expect(chips[0].text).toBe('Tank · Placements 10/10 · confirm rank');
    expect(chips[0].tone).toBe('placement');
  });

  it('a completed run yields the rank it wrote, in the placed tone', () => {
    const chips = accountRoleSummary('Main', [rank({ role: 'support', tier: 'Diamond', division: 5, progressPct: 0 })], [
      run({ role: 'support', counted: 10, completed: true }),
    ]);
    expect(chips).toEqual([{ role: 'support', text: 'Sup · D5 · 0%', tone: 'placed' }]);
  });

  it('rounds the % the way every other rank surface does', () => {
    expect(accountRoleSummary('Main', [rank({ role: 'tank', progressPct: 33.6 })], [])[0].text).toBe('Tank · G3 · 34%');
  });

  it('filters to the requested account, so callers can pass the whole ranks/placements lists', () => {
    const chips = accountRoleSummary('Alt', [
      rank({ role: 'tank' }), rank({ role: 'damage', account: 'Alt', tier: 'Bronze', division: 2, progressPct: 70 }),
    ], [run({ role: 'support' }), run({ role: 'support', account: 'Alt', counted: 7 })]);
    expect(chips.map((c) => c.text)).toEqual(['Dmg · B2 · 70%', 'Sup · Placements 7/10']);
  });

  it('is empty for an account that tracks nothing', () => {
    expect(accountRoleSummary('Nobody', [rank({ role: 'tank' })], [run({ role: 'tank' })])).toEqual([]);
  });
});
