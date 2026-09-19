import { describe, it, expect } from 'vitest';
import { games, gamesShort, net, pts, ratio, signed, RELATION_LABEL } from '../renderer/src/format';

/**
 * K7: one spelling per quantity. `signed` switches to the real minus sign
 * (U+2212) so it can't drift from Mental/the readiness wiki, which already
 * hand-wrote it; `games`/`net`/`pts`/`ratio` are the vocabulary every view
 * should reach for instead of a template string.
 */
describe('format.ts — one vocabulary (K7)', () => {
  it('signed() uses U+2212 for negatives, "+" for positives, plain "0" for zero', () => {
    expect(signed(3)).toBe('+3');
    expect(signed(-3)).toBe('−3');
    expect(signed(0)).toBe('0');
  });

  it('games() pluralizes correctly', () => {
    expect(games(1)).toBe('1 game');
    expect(games(8)).toBe('8 games');
    expect(games(0)).toBe('0 games');
  });

  it('gamesShort() is the compact chart-label form', () => {
    expect(gamesShort(8)).toBe('8g');
    expect(gamesShort(1)).toBe('1g');
  });

  it('net() signs and labels a win/loss differential', () => {
    expect(net(3)).toBe('+3 net');
    expect(net(-4)).toBe('−4 net');
    expect(net(0)).toBe('0 net');
  });

  it('pts() signs and labels a winrate-point delta', () => {
    expect(pts(18)).toBe('+18 pts');
    expect(pts(-24)).toBe('−24 pts');
  });

  it('ratio() always shows one decimal with the multiplier sign', () => {
    expect(ratio(0.76)).toBe('0.8×');
    expect(ratio(1)).toBe('1.0×');
    expect(ratio(0.755)).toBe('0.8×');
  });

  it('RELATION_LABEL gives one wording for the with/against relation', () => {
    expect(RELATION_LABEL.with).toEqual({ long: 'With you', short: 'with' });
    expect(RELATION_LABEL.against).toEqual({ long: 'Against you', short: 'vs' });
  });
});
