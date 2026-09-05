import { describe, it, expect } from 'vitest';
import {
  ALL_ACCOUNTS_GLYPH,
  ALL_ACCOUNTS_LABEL,
  accountCountLine,
  allAccountsLine,
  rankLine,
  sidebarChip,
  type SidebarChipInput,
} from '../renderer/src/sidebarChip';

/**
 * sidebarChip.ts is pure and DOM-free (a snapshot slice in, three strings out
 * over the shared roleStatus / format helpers), so it runs under the node
 * vitest environment — same pattern as roleStatus / winrateScheme. Covers the
 * pinned vs "All accounts" wording the top-left chip shows.
 */

const snapshot = (p: Partial<SidebarChipInput> = {}): SidebarChipInput => ({
  filters: { account: 'all' },
  options: { accounts: ['Karambo', 'Smurf', 'Alt'] },
  primaryRank: { account: 'Karambo', role: 'damage', tier: 'Grandmaster', division: 4, progressPct: 16, protected: false },
  placements: [],
  progression: { tier: 'Platinum', division: 1, progressPct: 62 },
  ...p,
});

describe('sidebarChip — unpinned ("All accounts")', () => {
  it('names the scope literally and attributes the rank line to its account', () => {
    expect(sidebarChip(snapshot())).toEqual({
      scope: 'all',
      name: ALL_ACCOUNTS_LABEL,
      glyph: ALL_ACCOUNTS_GLYPH,
      sub: 'Karambo · Dmg · GM4 · 16%',
      // The tooltip keeps the long form — it is the escape hatch the two-line
      // clamp depends on, so it must not shrink with the line it expands.
      subFull: 'Karambo · Dmg · Grandmaster 4 · 16%',
    });
  });

  it('uses a fixed glyph that is not an account initial', () => {
    expect(ALL_ACCOUNTS_LABEL).toBe('All accounts');
    expect(ALL_ACCOUNTS_GLYPH).toHaveLength(1);
    expect(ALL_ACCOUNTS_GLYPH).not.toMatch(/[A-Za-z]/);
    expect(sidebarChip(snapshot()).glyph).not.toBe('K');
  });

  it('keeps the shield and the open placement run in the attributed line', () => {
    const shielded = snapshot({ primaryRank: { account: 'Karambo', role: 'tank', tier: 'Diamond', division: 2, progressPct: 40, protected: true } });
    expect(sidebarChip(shielded).sub).toBe('Karambo · Tank · D2 · 40% 🛡');
    const placing = snapshot({
      primaryRank: { account: 'Smurf', role: 'support', tier: 'Gold', division: 3, progressPct: 50, protected: false },
      placements: [{ account: 'Smurf', role: 'support', completed: false, counted: 3, target: 10, awaitingRank: false }],
    });
    expect(sidebarChip(placing).sub).toBe('Smurf · Sup · Placements 3/10');
  });

  it('ignores placement runs on other tracks when attributing', () => {
    const other = snapshot({
      placements: [
        { account: 'Karambo', role: 'support', completed: false, counted: 2, target: 10, awaitingRank: false },
        { account: 'Karambo', role: 'damage', completed: true, counted: 10, target: 10, awaitingRank: false },
      ],
    });
    expect(sidebarChip(other).sub).toBe('Karambo · Dmg · GM4 · 16%');
  });

  it('falls back to a neutral account count when there is no rank to attribute', () => {
    expect(sidebarChip(snapshot({ primaryRank: undefined })).sub).toBe('3 accounts');
    expect(sidebarChip(snapshot({ primaryRank: undefined, options: { accounts: ['Solo'] } })).sub).toBe('1 account');
    expect(sidebarChip(snapshot({ primaryRank: undefined, options: { accounts: [] } })).sub).toBe('No accounts yet');
  });

  it('never shows the winrate heuristic for the whole-profile scope', () => {
    const chip = sidebarChip(snapshot({ primaryRank: undefined }));
    // Positive, not `not.toContain('Platinum')` — a negative assertion passes
    // even when the abbreviation silently stops firing, which is exactly the
    // failure mode the old string-replace had.
    expect(chip.sub).toBe('3 accounts');
  });
});

describe('sidebarChip — pinned to an account', () => {
  it('is that account: its name, its initial, and the role-prefixed rank line', () => {
    expect(sidebarChip(snapshot({ filters: { account: 'Karambo' } }))).toEqual({
      scope: 'account',
      name: 'Karambo',
      glyph: 'K',
      sub: 'Dmg · GM4 · 16%',
      subFull: 'Dmg · Grandmaster 4 · 16%',
    });
  });

  it('upper-cases the initial', () => {
    expect(sidebarChip(snapshot({ filters: { account: 'smurf' } })).glyph).toBe('S');
  });

  it('falls back to the winrate heuristic when the account has no anchor', () => {
    expect(sidebarChip(snapshot({ filters: { account: 'Alt' }, primaryRank: undefined })).sub).toBe('P1 · 62%');
  });

  it('shows the open run (with prediction) over the stale rank', () => {
    const d = snapshot({
      filters: { account: 'Karambo' },
      placements: [{ account: 'Karambo', role: 'damage', completed: false, counted: 7, target: 10, awaitingRank: false, latestPrediction: { tier: 'Master', division: 5 } }],
    });
    // The prediction shortens too — this is the longest string the app builds,
    // and it lands in the tightest box it has.
    expect(sidebarChip(d).sub).toBe('Dmg · Placements 7/10 · M5 (predicted)');
    expect(sidebarChip(d).subFull).toBe('Dmg · Placements 7/10 · Master 5 (predicted)');
  });
});

describe('sidebarChip — no snapshot', () => {
  it('shows the app name and a dash until the first load', () => {
    expect(sidebarChip(null)).toEqual({ scope: 'none', name: 'Vantage', glyph: 'V', sub: '—', subFull: '—' });
    expect(sidebarChip(undefined).scope).toBe('none');
  });
});

describe('rankLine / allAccountsLine / accountCountLine', () => {
  it('rankLine rounds the heuristic progress', () => {
    expect(rankLine(snapshot({ primaryRank: undefined, progression: { tier: 'Gold', division: 3, progressPct: 40.6 } }))).toBe('G3 · 41%');
  });

  it('allAccountsLine prefixes rankLine with the account', () => {
    const d = snapshot();
    expect(allAccountsLine(d)).toBe(`Karambo · ${rankLine(d)}`);
  });

  it('accountCountLine pluralises', () => {
    expect(accountCountLine(0)).toBe('No accounts yet');
    expect(accountCountLine(1)).toBe('1 account');
    expect(accountCountLine(2)).toBe('2 accounts');
    expect(accountCountLine(12)).toBe('12 accounts');
  });
});
