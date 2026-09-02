import { describe, it, expect } from 'vitest';
import { deployableOf, resolveHeroName } from '../src/core/resolvers/hero';
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

  it("returns undefined for GEP's \"not revealed\" sentinel instead of a fake hero named Unknown", () => {
    // Seen on a real teardown broadcast that reset every roster slot's hero_name
    // to this literal value — must not be treated as a picked hero.
    expect(resolveHeroName('UNKNOWN')).toBeUndefined();
    expect(resolveHeroName('Unknown')).toBeUndefined();
    expect(resolveHeroName('  unknown  ')).toBeUndefined();
  });

  it('round-trips every canonical hero through its own uppercasing (spelling guard)', () => {
    for (const hero of ALL_HEROES) {
      expect(resolveHeroName(hero.toUpperCase()), `"${hero}" did not round-trip`).toBe(hero);
    }
  });
});

describe('deployableOf', () => {
  it('recognises a hero\'s deployable and names both parts', () => {
    expect(deployableOf('Illari Healing Pylon')).toEqual({ hero: 'Illari', label: 'Healing Pylon' });
  });

  it('is case- and punctuation-insensitive, like every other hero lookup', () => {
    expect(deployableOf('TORBJÖRN TURRET')).toEqual({ hero: 'Torbjörn', label: 'Turret' });
    expect(deployableOf('torbjorn turret')?.hero).toBe('Torbjörn');
  });

  it('handles multi-word hero names', () => {
    expect(deployableOf('Wrecking Ball Minefield')).toEqual({ hero: 'Wrecking Ball', label: 'Minefield' });
  });

  it('is undefined for the hero themselves', () => {
    // The whole point: Illari the player must stay a player.
    expect(deployableOf('Illari')).toBeUndefined();
    expect(deployableOf('ILLARI')).toBeUndefined();
    expect(deployableOf('Wrecking Ball')).toBeUndefined();
  });

  it('is undefined for a name matching no hero at all', () => {
    // A brand-new hero this build doesn't know is a PLAYER, not a deployable —
    // counting their deaths is the safer failure than silently dropping them.
    expect(deployableOf('Somenewhero')).toBeUndefined();
    expect(deployableOf('418')).toBeUndefined();
  });

  it('is undefined for nullish and empty input', () => {
    expect(deployableOf(undefined)).toBeUndefined();
    expect(deployableOf(null)).toBeUndefined();
    expect(deployableOf('   ')).toBeUndefined();
  });
});
