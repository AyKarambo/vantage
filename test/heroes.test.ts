import { describe, it, expect } from 'vitest';
import { ALL_HEROES, HEROES_BY_ROLE, roleOfHero, heroMatchKey } from '../src/core/heroes';
import { HEROES as SAMPLE_POOLS } from '../src/core/sampleData/fixtures';

describe('canonical hero list', () => {
  it('has a non-empty pool per role with no duplicates', () => {
    for (const [role, pool] of Object.entries(HEROES_BY_ROLE)) {
      expect(pool.length, role).toBeGreaterThan(0);
      expect(new Set(pool).size, role).toBe(pool.length);
    }
  });

  it('flattens to a sorted, duplicate-free ALL_HEROES', () => {
    expect(new Set(ALL_HEROES).size).toBe(ALL_HEROES.length);
    expect([...ALL_HEROES].sort((a, b) => a.localeCompare(b))).toEqual([...ALL_HEROES]);
  });

  it('covers every hero the sample generator uses (fixtures stay a subset)', () => {
    const all = new Set(ALL_HEROES);
    for (const pool of Object.values(SAMPLE_POOLS)) {
      for (const hero of pool) expect(all.has(hero), hero).toBe(true);
    }
  });
});

describe('roleOfHero', () => {
  it('maps each canonical hero to its role', () => {
    expect(roleOfHero('Reinhardt')).toBe('tank');
    expect(roleOfHero('Tracer')).toBe('damage');
    expect(roleOfHero('Ana')).toBe('support');
  });

  it('survives GEP casing, accents and punctuation', () => {
    expect(roleOfHero('lúcio')).toBe('support');
    expect(roleOfHero('LUCIO')).toBe('support');
    expect(roleOfHero('d.va')).toBe('tank');
    expect(roleOfHero('soldier: 76')).toBe('damage');
    expect(roleOfHero('torbjörn')).toBe('damage');
  });

  it('never guesses an unknown hero or empty input', () => {
    expect(roleOfHero('Not A Hero')).toBeUndefined();
    expect(roleOfHero(undefined)).toBeUndefined();
    expect(roleOfHero('')).toBeUndefined();
  });

  it('heroMatchKey folds to ascii lowercase alphanumerics', () => {
    expect(heroMatchKey('Lúcio')).toBe('lucio');
    expect(heroMatchKey('D.Va')).toBe('dva');
    expect(heroMatchKey('Soldier: 76')).toBe('soldier76');
  });
});
