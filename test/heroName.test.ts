import { describe, it, expect } from 'vitest';
import { resolveHeroName } from '../src/core/resolvers/hero';
import { ALL_HEROES } from '../src/core/heroes';

describe('resolveHeroName', () => {
  it('canonicalizes the ALL-CAPS names GEP actually reports', () => {
    expect(resolveHeroName('ANA')).toBe('Ana');
    expect(resolveHeroName('SHION')).toBe('Shion');
    expect(resolveHeroName('RAMATTRA')).toBe('Ramattra');
    expect(resolveHeroName('ROADHOG')).toBe('Roadhog');
    expect(resolveHeroName('CASSIDY')).toBe('Cassidy');
    expect(resolveHeroName('BRIGITTE')).toBe('Brigitte');
    expect(resolveHeroName('ZARYA')).toBe('Zarya');
  });

  it('matches diacritic- and punctuation-insensitively', () => {
    expect(resolveHeroName('LUCIO')).toBe('Lúcio');
    expect(resolveHeroName('TORBJORN')).toBe('Torbjörn');
    expect(resolveHeroName('SOLDIER: 76')).toBe('Soldier: 76');
    expect(resolveHeroName('WRECKING BALL')).toBe('Wrecking Ball');
    expect(resolveHeroName('JUNKER QUEEN')).toBe('Junker Queen');
    expect(resolveHeroName('D.VA')).toBe('D.Va');
    expect(resolveHeroName('DVA')).toBe('D.Va');
  });

  it('is idempotent on already-canonical names', () => {
    expect(resolveHeroName('Tracer')).toBe('Tracer');
    expect(resolveHeroName('Lúcio')).toBe('Lúcio');
    expect(resolveHeroName('Soldier: 76')).toBe('Soldier: 76');
  });

  it('title-cases an unlisted hero (graceful degrade, still flows through)', () => {
    expect(resolveHeroName('SOME NEW HERO')).toBe('Some New Hero');
  });

  it('returns undefined for empty/nullish', () => {
    expect(resolveHeroName(undefined)).toBeUndefined();
    expect(resolveHeroName(null)).toBeUndefined();
    expect(resolveHeroName('')).toBeUndefined();
    expect(resolveHeroName('   ')).toBeUndefined();
  });

  it('round-trips every canonical hero through its own uppercasing (spelling guard)', () => {
    for (const hero of ALL_HEROES) {
      expect(resolveHeroName(hero.toUpperCase()), `"${hero}" did not round-trip`).toBe(hero);
    }
  });
});
