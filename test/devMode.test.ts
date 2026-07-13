import { describe, it, expect } from 'vitest';
import { computeDevMode } from '../src/core/devMode';

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
