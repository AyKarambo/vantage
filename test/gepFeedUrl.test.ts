import { describe, it, expect } from 'vitest';
import { gepStatusFeedUrl } from '../src/core/gepService';
import { computeDevMode } from '../src/core/devMode';

describe('gepStatusFeedUrl', () => {
  it('points at the environment it is asked for', () => {
    expect(gepStatusFeedUrl(10844, 'prod')).toBe('https://game-events-status.overwolf.com/10844_prod.json');
    expect(gepStatusFeedUrl(10844, 'dev')).toBe('https://game-events-status.overwolf.com/10844_dev.json');
  });

  it('works for any game id', () => {
    expect(gepStatusFeedUrl(5426, 'prod')).toBe('https://game-events-status.overwolf.com/5426_prod.json');
  });
});

// The pairing that matters: which feed the poller reads is decided by whether the
// app is in Dev Mode, because that's what decides which environment owepm loaded
// the gaming packages from. Getting this backwards is what made the app announce a
// GEP outage to a developer whose GEP was fine — Overwatch's prod feed is an
// unpublished placeholder while its dev feed is green.
describe('feed choice follows Dev Mode', () => {
  const feedFor = (packaged: boolean, env: Record<string, string | undefined>) =>
    gepStatusFeedUrl(10844, computeDevMode({ packaged, env }) ? 'dev' : 'prod');

  it('reads the dev feed for an unpackaged build with a dev key', () => {
    expect(feedFor(false, { OW_DEV_KEY: 'k' })).toContain('_dev.json');
  });

  it('reads the dev feed for an unpackaged build with an API-key pair', () => {
    expect(feedFor(false, { OW_CLI_EMAIL: 'a@b.c', OW_CLI_API_KEY: 'k' })).toContain('_dev.json');
  });

  it('reads the prod feed for a packaged build, even if credentials are lying around', () => {
    // Dev Mode cannot activate in a packaged build, so prod is the truth there.
    expect(feedFor(true, { OW_DEV_KEY: 'k' })).toContain('_prod.json');
  });

  it('reads the prod feed for an unpackaged build with no credentials', () => {
    // No credentials means no gaming packages at all — nothing dev about it.
    expect(feedFor(false, {})).toContain('_prod.json');
  });

  it('reads the prod feed when only half the API-key pair is present', () => {
    expect(feedFor(false, { OW_CLI_EMAIL: 'a@b.c' })).toContain('_prod.json');
  });
});
