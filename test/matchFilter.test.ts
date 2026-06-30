import { describe, it, expect } from 'vitest';
import { shouldLog, classifyGameType, gameTypeLabel } from '../src/core/matchFilter';
import { emptyMatch, type MatchRecord } from '../src/core/model';

function rec(gameType?: string): MatchRecord {
  return { ...emptyMatch('m1'), gameType };
}

describe('classifyGameType', () => {
  it('classifies the common modes', () => {
    expect(classifyGameType('Competitive')).toBe('competitive');
    expect(classifyGameType('ranked')).toBe('competitive');
    expect(classifyGameType('Quick Play')).toBe('quickplay');
    expect(classifyGameType('arcade')).toBe('arcade');
    expect(classifyGameType('Stadium')).toBe('stadium');
    expect(classifyGameType('custom game')).toBe('custom');
  });

  it('treats Counterwatch Ranked/Unranked correctly', () => {
    // "Unranked" contains "ranked" — must not be misread as competitive.
    expect(classifyGameType('Unranked')).toBe('quickplay');
    expect(classifyGameType('Ranked')).toBe('competitive');
  });
});

describe('gameTypeLabel', () => {
  it('produces clean Notion labels', () => {
    expect(gameTypeLabel('competitive')).toBe('Competitive');
    expect(gameTypeLabel('quickplay')).toBe('Quick Play');
  });
});

describe('shouldLog', () => {
  it('Competitive filter keeps only competitive', () => {
    expect(shouldLog(rec('Competitive'), 'Competitive')).toBe(true);
    expect(shouldLog(rec('Quick Play'), 'Competitive')).toBe(false);
    expect(shouldLog(rec('Arcade'), 'Competitive')).toBe(false);
  });
  it('CompetitiveAndQuickPlay keeps both', () => {
    expect(shouldLog(rec('Competitive'), 'CompetitiveAndQuickPlay')).toBe(true);
    expect(shouldLog(rec('Quick Play'), 'CompetitiveAndQuickPlay')).toBe(true);
    expect(shouldLog(rec('Arcade'), 'CompetitiveAndQuickPlay')).toBe(false);
  });
  it('Everything keeps all', () => {
    expect(shouldLog(rec('Arcade'), 'Everything')).toBe(true);
    expect(shouldLog(rec(undefined), 'Everything')).toBe(true);
  });
});
