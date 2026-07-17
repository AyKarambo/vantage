import { describe, it, expect } from 'vitest';
import {
  shouldShowWhatsNew,
  changelogSince,
  changelogHistory,
  type ChangelogEntry,
} from '../src/core/whatsNew';

const entries: ChangelogEntry[] = [
  { version: 'unreleased', notes: ['not stamped yet'] },
  { version: '0.32.0', date: '15 July 2026', notes: ['Focus Trend', 'Aatlis fix'] },
  { version: '0.31.0', date: '12 July 2026', notes: ['older thing'] },
  { version: '0.30.0', date: '9 July 2026', notes: ['oldest thing'] },
];

describe('shouldShowWhatsNew', () => {
  it('shows nothing on a fresh install (no last-seen version)', () => {
    // The decisive case: with nothing recorded we cannot tell a first launch from
    // an upgrade, and a first launch already gets the intro tour.
    expect(shouldShowWhatsNew(undefined, '0.32.0')).toBe(false);
    expect(shouldShowWhatsNew('', '0.32.0')).toBe(false);
  });

  it('shows after an update', () => {
    expect(shouldShowWhatsNew('0.31.0', '0.32.0')).toBe(true);
    expect(shouldShowWhatsNew('0.31.9', '0.32.0')).toBe(true);
    expect(shouldShowWhatsNew('0.9.0', '1.0.0')).toBe(true);
    expect(shouldShowWhatsNew('1.2.3', '1.2.4')).toBe(true);
  });

  it('shows nothing when the version is unchanged — so it appears once, not every launch', () => {
    expect(shouldShowWhatsNew('0.32.0', '0.32.0')).toBe(false);
  });

  it('shows nothing on a downgrade', () => {
    expect(shouldShowWhatsNew('0.32.0', '0.31.0')).toBe(false);
    expect(shouldShowWhatsNew('1.0.0', '0.9.9')).toBe(false);
  });

  it('compares numerically, not lexically', () => {
    expect(shouldShowWhatsNew('0.9.0', '0.10.0')).toBe(true);
    expect(shouldShowWhatsNew('0.10.0', '0.9.0')).toBe(false);
    expect(shouldShowWhatsNew('1.2.9', '1.2.10')).toBe(true);
  });

  it('shows nothing for unparseable versions rather than guessing', () => {
    expect(shouldShowWhatsNew('0.31.0', 'unreleased')).toBe(false);
    expect(shouldShowWhatsNew('nonsense', '0.32.0')).toBe(false);
    expect(shouldShowWhatsNew('0.31', '0.32.0')).toBe(false);
    expect(shouldShowWhatsNew('0.31.0', '0.32.0-beta.1')).toBe(false);
    expect(shouldShowWhatsNew('0.31.0', undefined)).toBe(false);
  });

  it('never throws on junk input', () => {
    expect(() => shouldShowWhatsNew(undefined, undefined)).not.toThrow();
    expect(shouldShowWhatsNew(null as unknown as string, 42 as unknown as string)).toBe(false);
  });

  it('tolerates surrounding whitespace', () => {
    expect(shouldShowWhatsNew(' 0.31.0 ', '0.32.0')).toBe(true);
  });
});

describe('changelogSince', () => {
  it('returns only newer entries, newest first', () => {
    expect(changelogSince(entries, '0.30.0').map((e) => e.version)).toEqual(['0.32.0', '0.31.0']);
  });

  it('returns nothing when the user is current', () => {
    expect(changelogSince(entries, '0.32.0')).toEqual([]);
  });

  it('agrees with shouldShowWhatsNew on a fresh install — the prompt must not open on an empty list', () => {
    expect(shouldShowWhatsNew(undefined, '0.32.0')).toBe(false);
    expect(changelogSince(entries, undefined)).toEqual([]);
  });

  it('skips an unstamped Unreleased heading instead of showing it to everyone forever', () => {
    expect(changelogSince(entries, '0.30.0').some((e) => e.version === 'unreleased')).toBe(false);
  });

  it('handles an empty changelog', () => {
    expect(changelogSince([], '0.30.0')).toEqual([]);
  });

  it('keeps the entry payload intact', () => {
    const [newest] = changelogSince(entries, '0.31.0');
    expect(newest).toEqual({ version: '0.32.0', date: '15 July 2026', notes: ['Focus Trend', 'Aatlis fix'] });
  });
});

describe('changelogHistory', () => {
  it('returns every stamped entry newest-first, regardless of last-seen', () => {
    expect(changelogHistory(entries).map((e) => e.version)).toEqual(['0.32.0', '0.31.0', '0.30.0']);
  });

  it('drops unstamped entries', () => {
    expect(changelogHistory(entries).some((e) => e.version === 'unreleased')).toBe(false);
  });

  it('handles an empty changelog', () => {
    expect(changelogHistory([])).toEqual([]);
  });
});
