import { describe, it, expect } from 'vitest';
import {
  mergeAccountList, isConfiguredAccount, shouldAutoSwitch, localBattleTag, recoverableAccount,
  UNKNOWN_ACCOUNT,
} from '../src/core/accountsManage';
import type { RosterPlayer } from '../src/core/model';

describe('mergeAccountList — union + de-dup (F2)', () => {
  it('lists every configured account, even ones with no history', () => {
    const list = mergeAccountList({ 'Karambo#21234': 'Karambo', 'Alt#1': 'Alt' }, []);
    expect(list).toEqual([
      { battleTag: 'Karambo#21234', label: 'Karambo', kind: 'configured', games: 0 },
      { battleTag: 'Alt#1', label: 'Alt', kind: 'configured', games: 0 },
    ]);
  });

  it('rolls history games that resolve to a configured account into that row (no separate entry)', () => {
    // 'Karambo' is the resolved label already stored on the games; it name-only
    // resolves back to the configured battleTag, so it must NOT appear separately.
    const list = mergeAccountList({ 'Karambo#21234': 'Karambo' }, ['Karambo', 'Karambo', 'Karambo']);
    expect(list).toEqual([
      { battleTag: 'Karambo#21234', label: 'Karambo', kind: 'configured', games: 3 },
    ]);
  });

  it('surfaces the Unknown bucket and raw unlabelled tags as manageable detected entries', () => {
    const list = mergeAccountList(
      { 'Karambo#21234': 'Karambo' },
      ['Karambo', 'Rando#4521', 'Rando#4521', UNKNOWN_ACCOUNT],
    );
    expect(list).toEqual([
      { battleTag: 'Karambo#21234', label: 'Karambo', kind: 'configured', games: 1 },
      { battleTag: 'Rando#4521', label: 'Rando#4521', kind: 'unlabeled', games: 2 },
      { battleTag: UNKNOWN_ACCOUNT, label: UNKNOWN_ACCOUNT, kind: 'unknown', games: 1 },
    ]);
  });

  it('de-dups a raw tag that resolves to a configured account case/name-insensitively', () => {
    // Config keyed by a lowercase battleTag; the stored history value is a raw
    // tag with a different discriminator — resolveAccount name-only matches it.
    const list = mergeAccountList({ 'karambo#21442': 'karambo' }, ['Karambo#99999']);
    expect(list).toEqual([
      { battleTag: 'karambo#21442', label: 'karambo', kind: 'configured', games: 1 },
    ]);
  });

  it('ignores empty account strings', () => {
    const list = mergeAccountList({}, ['', 'Rando#1', '']);
    expect(list).toEqual([{ battleTag: 'Rando#1', label: 'Rando#1', kind: 'unlabeled', games: 1 }]);
  });
});

describe('isConfiguredAccount', () => {
  const accounts = { 'Karambo#21234': 'Karambo' };
  it('is true for a resolved label passed straight back in', () => {
    expect(isConfiguredAccount('Karambo', accounts)).toBe(true);
  });
  it('is true for the raw configured battleTag (case-insensitive)', () => {
    expect(isConfiguredAccount('karambo#21234', accounts)).toBe(true);
  });
  it('is true for a stored label that shares no name with its battleTag', () => {
    // The common live case: history stores the label ("Main"), whose battleTag
    // ("Player#1234") name-only match would miss — the direct label match saves it.
    expect(isConfiguredAccount('Main', { 'Player#1234': 'Main' })).toBe(true);
  });
  it('is false for an unmapped raw tag, Unknown, or undefined', () => {
    expect(isConfiguredAccount('Rando#4521', accounts)).toBe(false);
    expect(isConfiguredAccount(UNKNOWN_ACCOUNT, accounts)).toBe(false);
    expect(isConfiguredAccount(undefined, accounts)).toBe(false);
  });
});

describe('mergeAccountList — de-dups a stored label unrelated to its battleTag', () => {
  it('rolls "Main" games into the Player#1234 → Main configured row', () => {
    const list = mergeAccountList({ 'Player#1234': 'Main' }, ['Main', 'Main']);
    expect(list).toEqual([
      { battleTag: 'Player#1234', label: 'Main', kind: 'configured', games: 2 },
    ]);
  });
});

describe('shouldAutoSwitch — auto-switch decision (F4)', () => {
  it('switches when scoped to a specific account and a different configured account logs', () => {
    expect(shouldAutoSwitch('Karambo', { account: 'Baranbo', configured: true })).toBe(true);
  });
  it('never switches from "All accounts"', () => {
    expect(shouldAutoSwitch('all', { account: 'Baranbo', configured: true })).toBe(false);
  });
  it('never switches for an unmapped/unknown account', () => {
    expect(shouldAutoSwitch('Karambo', { account: 'Rando#4521', configured: false })).toBe(false);
    expect(shouldAutoSwitch('Karambo', { account: UNKNOWN_ACCOUNT, configured: false })).toBe(false);
  });
  it('does not switch when the logged account already matches the current selection', () => {
    expect(shouldAutoSwitch('Karambo', { account: 'Karambo', configured: true })).toBe(false);
  });
  it('does not switch on an empty account', () => {
    expect(shouldAutoSwitch('Karambo', { account: '', configured: true })).toBe(false);
  });
});

describe('localBattleTag / recoverableAccount — legacy recovery (F1)', () => {
  const roster: RosterPlayer[] = [
    { battleTag: 'Enemy#1', heroName: 'Reaper' },
    { battleTag: 'Karambo#21234', heroName: 'Ana', isLocal: true },
  ];
  it('extracts the local player BattleTag from the roster', () => {
    expect(localBattleTag(roster)).toBe('Karambo#21234');
    expect(localBattleTag(undefined)).toBeUndefined();
    expect(localBattleTag([{ battleTag: 'Enemy#1' }])).toBeUndefined(); // no isLocal entry
  });
  it('recovers a configured label from the local roster tag', () => {
    expect(recoverableAccount(roster, { 'Karambo#21234': 'Karambo' })).toBe('Karambo');
  });
  it('returns undefined when the local tag maps to no configured account', () => {
    expect(recoverableAccount(roster, { 'Someone#9': 'Someone' })).toBeUndefined();
    expect(recoverableAccount(undefined, { 'Karambo#21234': 'Karambo' })).toBeUndefined();
  });
});
