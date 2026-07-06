import { describe, it, expect } from 'vitest';
import {
  effectiveMatchId, embeddedPageId, rowRefOf, groupByEffectiveMatchId, pickCanonicalRow,
} from '../src/notion/dedup';

const HAND_PAGE_ID = '12345678-1234-1234-1234-123456789abc';
const HAND_PAGE_ID_HEX = HAND_PAGE_ID.replace(/-/g, '');
const DERIVED_ID = `manual-notion-${HAND_PAGE_ID_HEX}`;

describe('effectiveMatchId', () => {
  it('prefers non-empty Match ID text', () => {
    expect(effectiveMatchId('page-1', 'gep-match-42')).toBe('gep-match-42');
  });

  it('derives manual-notion-<hex> from the page id (dashes stripped) when text is absent', () => {
    expect(effectiveMatchId(HAND_PAGE_ID, undefined)).toBe(DERIVED_ID);
  });

  it('treats whitespace-only Match ID text as absent', () => {
    expect(effectiveMatchId(HAND_PAGE_ID, '   ')).toBe(DERIVED_ID);
  });

  it('treats empty-string Match ID text as absent', () => {
    expect(effectiveMatchId(HAND_PAGE_ID, '')).toBe(DERIVED_ID);
  });
});

describe('embeddedPageId', () => {
  it('round-trips with effectiveMatchId: recovers the dashed page id from its derived id', () => {
    const derived = effectiveMatchId(HAND_PAGE_ID, undefined);
    expect(embeddedPageId(derived)).toBe(HAND_PAGE_ID.toLowerCase());
  });

  it('lowercases the recovered uuid', () => {
    expect(embeddedPageId(`manual-notion-${HAND_PAGE_ID_HEX.toUpperCase()}`)).toBe(HAND_PAGE_ID.toLowerCase());
  });

  it('is undefined for a GEP match id', () => {
    expect(embeddedPageId('gep-match-42')).toBeUndefined();
  });

  it('is undefined for a legacy manual-<timestamp> id (not the notion-hex shape)', () => {
    expect(embeddedPageId('manual-1700000000000')).toBeUndefined();
  });

  it('is undefined when the hex suffix is the wrong length (too short)', () => {
    expect(embeddedPageId(`manual-notion-${HAND_PAGE_ID_HEX.slice(0, 31)}`)).toBeUndefined();
  });

  it('is undefined when the hex suffix is the wrong length (too long)', () => {
    expect(embeddedPageId(`manual-notion-${HAND_PAGE_ID_HEX}ab`)).toBeUndefined();
  });

  it('is undefined when the suffix contains non-hex characters', () => {
    expect(embeddedPageId(`manual-notion-${'g'.repeat(32)}`)).toBeUndefined();
  });
});

describe('rowRefOf', () => {
  it('projects id, created_time, and joined Match ID rich_text', () => {
    const page = {
      id: 'page-1',
      created_time: '2024-01-01T00:00:00.000Z',
      properties: { 'Match ID': { rich_text: [{ plain_text: 'gep-' }, { plain_text: '42' }] } },
    };
    expect(rowRefOf(page)).toEqual({
      pageId: 'page-1', createdTime: '2024-01-01T00:00:00.000Z', matchIdText: 'gep-42',
    });
  });

  it('falls back to text.content when plain_text is absent', () => {
    const page = {
      id: 'page-1',
      properties: { 'Match ID': { rich_text: [{ text: { content: 'from-content' } }] } },
    };
    expect(rowRefOf(page).matchIdText).toBe('from-content');
  });

  it('trims the joined text and omits matchIdText when it is empty', () => {
    const page = { id: 'page-1', properties: { 'Match ID': { rich_text: [{ plain_text: '  ' }] } } };
    const ref = rowRefOf(page);
    expect(ref.matchIdText).toBeUndefined();
    expect(ref).not.toHaveProperty('matchIdText');
  });

  it('omits matchIdText when the Match ID property has no rich_text array', () => {
    const page = { id: 'page-1', properties: { 'Match ID': { rich_text: [] } } };
    expect(rowRefOf(page).matchIdText).toBeUndefined();
  });

  it('is tolerant of a missing Match ID property entirely', () => {
    const page = { id: 'page-1', properties: {} };
    expect(rowRefOf(page)).toEqual({ pageId: 'page-1', createdTime: undefined });
  });

  it('omits createdTime when created_time is absent', () => {
    const page = { id: 'page-1', properties: {} };
    expect(rowRefOf(page).createdTime).toBeUndefined();
  });
});

describe('groupByEffectiveMatchId', () => {
  it('groups rows sharing the same derived id together (hand row + its re-created copy)', () => {
    const hand = { pageId: HAND_PAGE_ID };
    const copy = { pageId: 'page-copy', matchIdText: DERIVED_ID };
    const groups = groupByEffectiveMatchId([hand, copy]);
    expect(groups.size).toBe(1);
    expect(groups.get(DERIVED_ID)).toEqual([hand, copy]);
  });

  it('includes singleton groups (no duplicate) alongside duplicate groups', () => {
    const unique = { pageId: 'page-unique', matchIdText: 'gep-1' };
    const hand = { pageId: HAND_PAGE_ID };
    const copy = { pageId: 'page-copy', matchIdText: DERIVED_ID };
    const groups = groupByEffectiveMatchId([unique, hand, copy]);
    expect(groups.size).toBe(2);
    expect(groups.get('gep-1')).toEqual([unique]);
    expect(groups.get(DERIVED_ID)).toEqual([hand, copy]);
  });

  it('returns an empty map for no rows', () => {
    expect(groupByEffectiveMatchId([]).size).toBe(0);
  });
});

describe('pickCanonicalRow', () => {
  it('returns the only row for a singleton group', () => {
    const row = { pageId: 'page-1' };
    expect(pickCanonicalRow([row])).toBe(row);
  });

  it('prefers the row whose page id is embedded in the group effective id (the original hand row)', () => {
    const hand = { pageId: HAND_PAGE_ID, createdTime: '2024-02-01T00:00:00.000Z' };
    const copy = { pageId: 'page-copy', matchIdText: DERIVED_ID, createdTime: '2024-01-01T00:00:00.000Z' };
    // copy is earlier and would win on createdTime alone — embedded-id precedence must override that.
    expect(pickCanonicalRow([copy, hand])).toBe(hand);
  });

  it('falls back to the ledgered page when no row embeds the effective id', () => {
    const a = { pageId: 'page-a', matchIdText: 'gep-1', createdTime: '2024-02-01T00:00:00.000Z' };
    const b = { pageId: 'page-b', matchIdText: 'gep-1', createdTime: '2024-01-01T00:00:00.000Z' };
    expect(pickCanonicalRow([a, b], { ledgeredPageId: 'page-a' })).toBe(a);
  });

  it('falls back to earliest createdTime when no embedded id and no ledger match', () => {
    const a = { pageId: 'page-a', matchIdText: 'gep-1', createdTime: '2024-02-01T00:00:00.000Z' };
    const b = { pageId: 'page-b', matchIdText: 'gep-1', createdTime: '2024-01-01T00:00:00.000Z' };
    expect(pickCanonicalRow([a, b])).toBe(b);
    expect(pickCanonicalRow([a, b], { ledgeredPageId: 'page-nonexistent' })).toBe(b);
  });

  it('sorts rows missing createdTime last', () => {
    const withTime = { pageId: 'page-a', matchIdText: 'gep-1', createdTime: '2024-01-01T00:00:00.000Z' };
    const noTime = { pageId: 'page-b', matchIdText: 'gep-1' };
    expect(pickCanonicalRow([noTime, withTime])).toBe(withTime);
  });

  it('tiebreaks equal createdTime lexicographically by pageId', () => {
    const b = { pageId: 'page-b', matchIdText: 'gep-1', createdTime: '2024-01-01T00:00:00.000Z' };
    const a = { pageId: 'page-a', matchIdText: 'gep-1', createdTime: '2024-01-01T00:00:00.000Z' };
    expect(pickCanonicalRow([b, a])).toBe(a);
  });

  it('tiebreaks lexicographically by pageId when both rows are missing createdTime', () => {
    const b = { pageId: 'page-b', matchIdText: 'gep-1' };
    const a = { pageId: 'page-a', matchIdText: 'gep-1' };
    expect(pickCanonicalRow([b, a])).toBe(a);
  });

  it('is deterministic regardless of input order', () => {
    const hand = { pageId: HAND_PAGE_ID, createdTime: '2024-02-01T00:00:00.000Z' };
    const copy = { pageId: 'page-copy', matchIdText: DERIVED_ID, createdTime: '2024-01-01T00:00:00.000Z' };
    const third = { pageId: 'page-third', matchIdText: DERIVED_ID, createdTime: '2023-01-01T00:00:00.000Z' };
    const rows = [hand, copy, third];
    for (const perm of permutations(rows)) {
      expect(pickCanonicalRow(perm)).toBe(hand);
    }
  });
});

function permutations<T>(arr: T[]): T[][] {
  if (arr.length <= 1) return [arr];
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const p of permutations(rest)) result.push([arr[i], ...p]);
  }
  return result;
}
