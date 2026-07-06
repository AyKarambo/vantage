import { describe, it, expect } from 'vitest';
import { mergeImportedIntoLocal } from '../src/core/notionMerge';
import { NOTION_IMPROVEMENT_TARGET_ID } from '../src/core/targets/notionBookkeeping';
import type { GameRecord } from '../src/core/analytics';

const base: GameRecord = {
  matchId: 'm1',
  timestamp: 1000,
  account: 'Acct#1234',
  role: 'damage',
  map: 'Kings Row',
  result: 'win',
  gameType: 'Competitive',
  heroes: ['Tracer'],
};

describe('mergeImportedIntoLocal', () => {
  it('applies the bookkeeping grade when local has no review and imported carries one', () => {
    const imported: GameRecord = {
      ...base,
      review: { at: 2000, grades: { [NOTION_IMPROVEMENT_TARGET_ID]: 'missed' }, flags: {} },
    };
    const patch = mergeImportedIntoLocal(base, imported);
    expect(patch).toEqual({
      review: { at: 2000, grades: { [NOTION_IMPROVEMENT_TARGET_ID]: 'missed' }, flags: {} },
    });
  });

  it('leaves local review untouched when present, even with a different Notion grade', () => {
    const local: GameRecord = {
      ...base,
      review: { at: 500, grades: { 't-1': 'hit' }, flags: {} },
    };
    const imported: GameRecord = {
      ...base,
      review: { at: 2000, grades: { [NOTION_IMPROVEMENT_TARGET_ID]: 'missed' }, flags: {} },
    };
    const patch = mergeImportedIntoLocal(local, imported);
    expect(patch?.review).toBeUndefined();
  });

  it('adopts the imported mental record wholesale when local has none', () => {
    const imported: GameRecord = { ...base, mental: { tilt: true, toxicMates: false } };
    const patch = mergeImportedIntoLocal(base, imported);
    expect(patch).toEqual({ mental: { tilt: true, toxicMates: false } });
  });

  it('keeps local mental wholesale when present — an unchecked local flag stays unchecked', () => {
    const local: GameRecord = { ...base, mental: { tilt: false } };
    const imported: GameRecord = { ...base, mental: { tilt: true } };
    const patch = mergeImportedIntoLocal(local, imported);
    expect(patch?.mental).toBeUndefined();
  });

  it('returns null when nothing to change', () => {
    const local: GameRecord = {
      ...base,
      review: { at: 500, grades: { 't-1': 'hit' }, flags: {} },
      mental: { tilt: false },
    };
    const imported: GameRecord = {
      ...base,
      review: { at: 2000, grades: { [NOTION_IMPROVEMENT_TARGET_ID]: 'missed' }, flags: {} },
      mental: { tilt: true },
    };
    expect(mergeImportedIntoLocal(local, imported)).toBeNull();
  });

  it('returns null when local has no review/mental and imported has none either', () => {
    expect(mergeImportedIntoLocal(base, base)).toBeNull();
  });

  it('applies grade and adopts mental together when both are eligible', () => {
    const imported: GameRecord = {
      ...base,
      review: { at: 2000, grades: { [NOTION_IMPROVEMENT_TARGET_ID]: 'hit' }, flags: {} },
      mental: { toxicMates: true },
    };
    const patch = mergeImportedIntoLocal(base, imported);
    expect(patch).toEqual({
      review: { at: 2000, grades: { [NOTION_IMPROVEMENT_TARGET_ID]: 'hit' }, flags: {} },
      mental: { toxicMates: true },
    });
  });
});
