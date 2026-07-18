import { describe, it, expect } from 'vitest';
import {
  computeDevMode,
  hasDevCredentials,
  computeDevModeAttempted,
  decideDevModeAuthStrategy,
  classifyDevModeBadge,
} from '../src/core/devMode';

describe('computeDevMode', () => {
  it('is false for a packaged build regardless of credentials', () => {
    expect(computeDevMode({ packaged: true, env: { OW_DEV_KEY: 'k' } })).toBe(false);
    expect(computeDevMode({ packaged: true, env: { OW_CLI_EMAIL: 'e', OW_CLI_API_KEY: 'a' } })).toBe(false);
  });

  it('is true unpackaged with a dev key (bearer)', () => {
    expect(computeDevMode({ packaged: false, env: { OW_DEV_KEY: 'k' } })).toBe(true);
  });

  it('is true unpackaged with an email + api-key pair (key auth)', () => {
    expect(computeDevMode({ packaged: false, env: { OW_CLI_EMAIL: 'e', OW_CLI_API_KEY: 'a' } })).toBe(true);
  });

  it('is false unpackaged with no credentials', () => {
    expect(computeDevMode({ packaged: false, env: {} })).toBe(false);
  });

  it('needs BOTH email and api key for the key-auth path', () => {
    expect(computeDevMode({ packaged: false, env: { OW_CLI_EMAIL: 'e' } })).toBe(false);
    expect(computeDevMode({ packaged: false, env: { OW_CLI_API_KEY: 'a' } })).toBe(false);
  });

  it('treats empty strings as absent', () => {
    expect(computeDevMode({ packaged: false, env: { OW_DEV_KEY: '' } })).toBe(false);
    expect(computeDevMode({ packaged: false, env: { OW_CLI_EMAIL: '', OW_CLI_API_KEY: '' } })).toBe(false);
  });
});

describe('hasDevCredentials', () => {
  it('is true with a dev key (bearer)', () => {
    expect(hasDevCredentials({ OW_DEV_KEY: 'k' })).toBe(true);
  });

  it('is true with an email + api-key pair (key auth)', () => {
    expect(hasDevCredentials({ OW_CLI_EMAIL: 'e', OW_CLI_API_KEY: 'a' })).toBe(true);
  });

  it('is false with no credentials', () => {
    expect(hasDevCredentials({})).toBe(false);
  });

  it('needs BOTH email and api key for the key-auth path', () => {
    expect(hasDevCredentials({ OW_CLI_EMAIL: 'e' })).toBe(false);
    expect(hasDevCredentials({ OW_CLI_API_KEY: 'a' })).toBe(false);
  });

  it('treats empty strings as absent', () => {
    expect(hasDevCredentials({ OW_DEV_KEY: '' })).toBe(false);
    expect(hasDevCredentials({ OW_CLI_EMAIL: '', OW_CLI_API_KEY: '' })).toBe(false);
  });
});

describe('computeDevModeAttempted', () => {
  it('is false for a packaged build regardless of the attempt flag', () => {
    expect(computeDevModeAttempted({ packaged: true, env: { OW_DEV_MODE_ATTEMPT: '1' } })).toBe(false);
  });

  it('is true unpackaged when the launcher stamped the attempt flag', () => {
    expect(computeDevModeAttempted({ packaged: false, env: { OW_DEV_MODE_ATTEMPT: '1' } })).toBe(true);
  });

  it('is false unpackaged when the attempt flag is unset', () => {
    expect(computeDevModeAttempted({ packaged: false, env: {} })).toBe(false);
  });

  it('is false unpackaged when the attempt flag has any other value', () => {
    expect(computeDevModeAttempted({ packaged: false, env: { OW_DEV_MODE_ATTEMPT: '0' } })).toBe(false);
    expect(computeDevModeAttempted({ packaged: false, env: { OW_DEV_MODE_ATTEMPT: 'true' } })).toBe(false);
  });
});

describe('decideDevModeAuthStrategy', () => {
  it('is not-attempted when no dev-mode launch was intended', () => {
    expect(
      decideDevModeAuthStrategy({ attempted: false, hasCredentials: false, packagesAvailable: false })
    ).toBe('not-attempted');
    expect(
      decideDevModeAuthStrategy({ attempted: false, hasCredentials: true, packagesAvailable: true })
    ).toBe('not-attempted');
  });

  it('fails immediately when attempted but no credentials resolved', () => {
    expect(
      decideDevModeAuthStrategy({ attempted: true, hasCredentials: false, packagesAvailable: true })
    ).toBe('immediate-fail-no-credentials');
  });

  it('fails immediately when credentials exist but packages are unavailable at wiring time', () => {
    expect(
      decideDevModeAuthStrategy({ attempted: true, hasCredentials: true, packagesAvailable: false })
    ).toBe('immediate-fail-no-packages');
  });

  it('listens for the ready/failed-to-initialize events when attempted with credentials and packages available', () => {
    expect(
      decideDevModeAuthStrategy({ attempted: true, hasCredentials: true, packagesAvailable: true })
    ).toBe('listen');
  });

  it('prefers the no-credentials failure over the no-packages failure when both are missing', () => {
    expect(
      decideDevModeAuthStrategy({ attempted: true, hasCredentials: false, packagesAvailable: false })
    ).toBe('immediate-fail-no-credentials');
  });
});

describe('classifyDevModeBadge', () => {
  it('is hidden when no dev-mode launch was attempted, regardless of outcome', () => {
    expect(classifyDevModeBadge({ attempted: false, outcome: 'pending' })).toBe('hidden');
    expect(classifyDevModeBadge({ attempted: false, outcome: 'confirmed' })).toBe('hidden');
    expect(classifyDevModeBadge({ attempted: false, outcome: 'failed' })).toBe('hidden');
  });

  it('is authenticated once the outcome is confirmed', () => {
    expect(classifyDevModeBadge({ attempted: true, outcome: 'confirmed' })).toBe('authenticated');
  });

  it('is failed when the outcome is failed', () => {
    expect(classifyDevModeBadge({ attempted: true, outcome: 'failed' })).toBe('failed');
  });

  it('never shows authenticated (green) while pending — stays hidden until confirmed', () => {
    expect(classifyDevModeBadge({ attempted: true, outcome: 'pending' })).toBe('hidden');
  });
});
