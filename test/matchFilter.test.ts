import { describe, it, expect } from 'vitest';
import { isCompetitive, classifyGameType, gameTypeLabel } from '../src/core/matchFilter';

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

describe('isCompetitive', () => {
  it('is true for competitive game types', () => {
    expect(isCompetitive('Competitive')).toBe(true);
    expect(isCompetitive('ranked')).toBe(true);
    expect(isCompetitive('Ranked')).toBe(true);
  });
  it('is false for quick-play, arcade, stadium, custom, other, and undefined', () => {
    expect(isCompetitive('Quick Play')).toBe(false);
    expect(isCompetitive('Unranked')).toBe(false);
    expect(isCompetitive('Arcade')).toBe(false);
    expect(isCompetitive('Stadium')).toBe(false);
    expect(isCompetitive('custom game')).toBe(false);
    expect(isCompetitive('Mystery Heroes')).toBe(false);
    expect(isCompetitive(undefined)).toBe(false);
  });
});
