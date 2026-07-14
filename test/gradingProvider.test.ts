import { describe, it, expect, vi } from 'vitest';
import { createDataProvider, type DataProviderDeps } from '../src/main/dataProvider';
import type { AppConfig } from '../src/main/config';

describe('DataProvider — grading settings', () => {
  it('reads, normalizes + persists the partial margin, returning the clamped value', () => {
    const config = { grading: { partialMargin: 0.2 } } as unknown as AppConfig;
    const persistGrading = vi.fn();
    const deps = { getConfig: () => config, persistGrading } as unknown as DataProviderDeps;
    const provider = createDataProvider(deps);

    expect(provider.getGrading()).toEqual({ partialMargin: 0.2 });

    // Out of range → clamped into 0..0.5 on write, persisted, and mirrored on the live config.
    const saved = provider.setGrading({ partialMargin: 5 });
    expect(saved).toEqual({ partialMargin: 0.5 });
    expect(persistGrading).toHaveBeenCalledWith({ partialMargin: 0.5 });
    expect(config.grading).toEqual({ partialMargin: 0.5 });
  });
});
