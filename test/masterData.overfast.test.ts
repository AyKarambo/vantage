import { describe, it, expect } from 'vitest';
import { classifyGamemodes, parseOverfastHeroes, parseOverfastMaps } from '../src/core/masterData';

describe('classifyGamemodes', () => {
  it('maps competitive modes', () => {
    expect(classifyGamemodes(['push'])).toEqual({ mode: 'Push', keep: true });
    expect(classifyGamemodes(['flashpoint'])).toEqual({ mode: 'Flashpoint', keep: true });
    expect(classifyGamemodes(['control'])).toEqual({ mode: 'Control', keep: true });
    expect(classifyGamemodes(['clash'])).toEqual({ mode: 'Clash', keep: true });
  });

  it('drops arcade-only maps', () => {
    expect(classifyGamemodes(['deathmatch']).keep).toBe(false);
    expect(classifyGamemodes(['elimination', 'teamdeathmatch']).keep).toBe(false);
  });

  it('keeps an unrecognized (possibly new competitive) mode as Unknown for the user (AC 10)', () => {
    expect(classifyGamemodes(['brawlball'])).toEqual({ mode: 'Unknown', keep: true });
    expect(classifyGamemodes([])).toEqual({ mode: 'Unknown', keep: true });
  });
});

describe('parseOverfastHeroes', () => {
  it('parses valid heroes and normalizes role aliases', () => {
    const out = parseOverfastHeroes([
      { key: 'ana', name: 'Ana', role: 'support' },
      { key: 'cassidy', name: 'Cassidy', role: 'dps' },
      { key: 'dva', name: 'D.Va', role: 'tank' },
    ]);
    expect(out).toEqual([
      { name: 'Ana', role: 'support' },
      { name: 'Cassidy', role: 'damage' },
      { name: 'D.Va', role: 'tank' },
    ]);
  });

  it('skips malformed rows', () => {
    const out = parseOverfastHeroes([
      { name: 'Valid', role: 'tank' },
      { name: '', role: 'tank' },
      { name: 'NoRole' },
      { role: 'support' },
    ]);
    expect(out).toEqual([{ name: 'Valid', role: 'tank' }]);
  });

  it('throws on a non-array payload (AC 14)', () => {
    expect(() => parseOverfastHeroes({ oops: true })).toThrow();
  });

  it('throws when nothing usable remains (AC 14)', () => {
    expect(() => parseOverfastHeroes([{ name: '', role: 'x' }])).toThrow();
  });
});

describe('parseOverfastMaps', () => {
  it('parses maps and classifies modes', () => {
    const out = parseOverfastMaps([
      { name: 'Aatlis', gamemodes: ['flashpoint'] },
      { name: 'Ilios', gamemodes: ['control'] },
    ]);
    expect(out).toEqual([
      { name: 'Aatlis', mode: 'Flashpoint', isActive: true },
      { name: 'Ilios', mode: 'Control', isActive: true },
    ]);
  });

  it('drops arcade maps but keeps unknown-mode maps as Unknown', () => {
    const out = parseOverfastMaps([
      { name: 'Château Guillard', gamemodes: ['deathmatch'] },
      { name: 'NewCompMap', gamemodes: ['mysterymode'] },
    ]);
    expect(out).toEqual([{ name: 'NewCompMap', mode: 'Unknown', isActive: true }]);
  });

  it('throws on a non-array payload (AC 14)', () => {
    expect(() => parseOverfastMaps('nope')).toThrow();
  });
});
