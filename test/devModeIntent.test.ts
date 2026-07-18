import { describe, it, expect } from 'vitest';
import { resolveDevModeIntent } from '../scripts/ow-dev.mjs';

describe('resolveDevModeIntent', () => {
  it('follows the Settings toggle when no --force flag is present (on)', () => {
    expect(resolveDevModeIntent({ argv: [], settingsEnabled: true })).toEqual({
      enabled: true,
      forced: false,
    });
  });

  it('follows the Settings toggle when no --force flag is present (off)', () => {
    expect(resolveDevModeIntent({ argv: [], settingsEnabled: false })).toEqual({
      enabled: false,
      forced: false,
    });
  });

  it('--force overrides an off Settings toggle', () => {
    expect(resolveDevModeIntent({ argv: ['--force'], settingsEnabled: false })).toEqual({
      enabled: true,
      forced: true,
    });
  });

  it('--force is a no-op when the toggle is already on, but forced is still true', () => {
    expect(resolveDevModeIntent({ argv: ['--force'], settingsEnabled: true })).toEqual({
      enabled: true,
      forced: true,
    });
  });

  it('an unrelated positional arg does not trigger force', () => {
    expect(resolveDevModeIntent({ argv: ['.'], settingsEnabled: true })).toEqual({
      enabled: true,
      forced: false,
    });
  });
});
