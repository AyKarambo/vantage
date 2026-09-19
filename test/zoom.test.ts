import { describe, it, expect } from 'vitest';
import { clampZoom, ZOOM_MIN, ZOOM_MAX, ZOOM_DEFAULT } from '../src/core/zoom';

describe('clampZoom', () => {
  it('passes an in-range value through unchanged', () => {
    expect(clampZoom(1)).toBe(1);
    expect(clampZoom(1.1)).toBe(1.1);
  });

  it('clamps below the minimum up to ZOOM_MIN', () => {
    expect(clampZoom(0)).toBe(ZOOM_MIN);
    expect(clampZoom(0.5)).toBe(ZOOM_MIN);
  });

  it('clamps above the maximum down to ZOOM_MAX', () => {
    expect(clampZoom(2)).toBe(ZOOM_MAX);
    expect(clampZoom(1.31)).toBe(ZOOM_MAX);
  });

  it('rounds to 2 decimals (whole percentage points)', () => {
    expect(clampZoom(1.234)).toBe(1.23);
    expect(clampZoom(0.999)).toBe(1);
  });

  it('exports a sane default', () => {
    expect(ZOOM_DEFAULT).toBe(1);
    expect(clampZoom(ZOOM_DEFAULT)).toBe(ZOOM_DEFAULT);
  });
});
