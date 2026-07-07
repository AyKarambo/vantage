import { describe, it, expect } from 'vitest';
import {
  WINRATE_SCHEMES,
  WINRATE_SCHEME_DEFAULT,
  WINRATE_SCHEME_OPTIONS,
  resolveWinrateScheme,
  type WinrateScheme,
} from '../renderer/src/winrateScheme';

/**
 * The winrate scheme module is pure and DOM-free, so it can be exercised directly
 * under the node vitest environment (no polyfill needed). Covers the resolution +
 * legacy-colorblind migration (spec AC1/AC4) and per-scheme palette integrity,
 * including the colourblind ramp's no-green guarantee (AC3/AC6).
 */

const SCHEMES: WinrateScheme[] = ['aurora', 'teal-coral', 'colorblind'];
const HEX = /^#[0-9a-f]{6}$/i;

describe('resolveWinrateScheme', () => {
  it('passes a valid stored scheme through, no migration', () => {
    for (const s of SCHEMES) {
      expect(resolveWinrateScheme(s, undefined)).toEqual({ scheme: s, migratedFromColorblind: false });
    }
  });

  it('defaults to aurora when nothing is stored and no legacy pref', () => {
    expect(resolveWinrateScheme(undefined, undefined)).toEqual({ scheme: 'aurora', migratedFromColorblind: false });
    expect(resolveWinrateScheme(undefined, false)).toEqual({ scheme: 'aurora', migratedFromColorblind: false });
  });

  it('migrates a legacy colorblind=true to the colorblind scheme', () => {
    expect(resolveWinrateScheme(undefined, true)).toEqual({ scheme: 'colorblind', migratedFromColorblind: true });
  });

  it('lets a valid stored scheme win over a legacy colorblind flag', () => {
    expect(resolveWinrateScheme('aurora', true)).toEqual({ scheme: 'aurora', migratedFromColorblind: false });
  });

  it('falls back on garbage stored values (and still honours a legacy flag)', () => {
    for (const junk of ['nope', 123, null, {}, [], '']) {
      expect(resolveWinrateScheme(junk, false)).toEqual({ scheme: 'aurora', migratedFromColorblind: false });
      expect(resolveWinrateScheme(junk, true)).toEqual({ scheme: 'colorblind', migratedFromColorblind: true });
    }
  });
});

describe('WINRATE_SCHEMES integrity', () => {
  it('defines exactly the three schemes, aurora as the default', () => {
    expect(Object.keys(WINRATE_SCHEMES).sort()).toEqual([...SCHEMES].sort());
    expect(WINRATE_SCHEME_DEFAULT).toBe('aurora');
    expect(WINRATE_SCHEMES[WINRATE_SCHEME_DEFAULT]).toBeDefined();
  });

  it('every colour is a valid hex', () => {
    for (const s of SCHEMES) {
      const p = WINRATE_SCHEMES[s];
      for (const c of [p.win, p.winText, p.loss, p.lossText, p.mid]) {
        expect(c, `${s}: ${c}`).toMatch(HEX);
      }
    }
  });

  it('ramps run from a distinct loss hue to a distinct win hue, all in [0,360)', () => {
    for (const s of SCHEMES) {
      const { hue } = WINRATE_SCHEMES[s];
      const h0 = hue(0);
      const h1 = hue(1);
      expect(h0).not.toBeCloseTo(h1, 0);
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        expect(hue(t)).toBeGreaterThanOrEqual(0);
        expect(hue(t)).toBeLessThan(360);
      }
    }
  });

  it('aurora and teal-coral ramp warm (loss) → cool teal-green (win)', () => {
    for (const s of ['aurora', 'teal-coral'] as const) {
      const { hue } = WINRATE_SCHEMES[s];
      expect(hue(0)).toBeLessThan(40); // warm red/coral end
      expect(hue(1)).toBeGreaterThan(140); // teal-green end
      expect(hue(1)).toBeLessThan(200);
    }
  });

  it('the colourblind ramp never enters the green band (accessibility guard)', () => {
    const { hue } = WINRATE_SCHEMES.colorblind;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const h = hue(Math.min(t, 1));
      expect(h < 90 || h > 150, `t=${t.toFixed(2)} → hue ${h.toFixed(1)}`).toBe(true);
    }
  });
});

describe('WINRATE_SCHEME_OPTIONS', () => {
  it('lists every scheme once, aurora first, with non-empty labels', () => {
    expect(WINRATE_SCHEME_OPTIONS.map((o) => o.value)).toEqual(['aurora', 'teal-coral', 'colorblind']);
    for (const o of WINRATE_SCHEME_OPTIONS) {
      expect(WINRATE_SCHEMES[o.value]).toBeDefined();
      expect(o.label.length).toBeGreaterThan(0);
    }
  });
});
