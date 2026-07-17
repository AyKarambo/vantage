import { describe, it, expect } from 'vitest';
import { classifyNetworkError, friendlyNetworkMessage } from '../src/core/netError';

describe('classifyNetworkError', () => {
  it('classifies the real TypeError Electron/undici net.fetch throws as offline', () => {
    expect(classifyNetworkError(new TypeError('fetch failed'))).toBe('offline');
  });

  // Electron's net.fetch rejects with the RAW ClientRequest error, not an undici
  // TypeError('fetch failed') wrapper — so these plain `net::ERR_*` messages are what
  // masterDataUpdate.ts and statusFeed.ts actually hand us when the machine is offline.
  // Missing them meant the app's only non-Notion outbound path said "something went
  // wrong" instead of "check your connection".
  it('classifies Chromium net::ERR_* messages from Electron net.fetch', () => {
    expect(classifyNetworkError(new Error('net::ERR_NAME_NOT_RESOLVED'))).toBe('offline');
    expect(classifyNetworkError(new Error('net::ERR_INTERNET_DISCONNECTED'))).toBe('offline');
    expect(classifyNetworkError(new Error('net::ERR_CONNECTION_REFUSED'))).toBe('offline');
    expect(classifyNetworkError(new Error('net::ERR_NETWORK_CHANGED'))).toBe('offline');
    expect(classifyNetworkError(new Error('net::ERR_PROXY_CONNECTION_FAILED'))).toBe('offline');
    expect(classifyNetworkError(new Error('net::ERR_NAME_RESOLUTION_FAILED'))).toBe('offline');
  });

  it('classifies Chromium timeout errors as timeout, not offline', () => {
    expect(classifyNetworkError(new Error('net::ERR_TIMED_OUT'))).toBe('timeout');
    expect(classifyNetworkError(new Error('net::ERR_CONNECTION_TIMED_OUT'))).toBe('timeout');
  });

  it('does not treat an unrelated net::ERR_* as a connection problem', () => {
    // A certificate or protocol failure is real and reachable — but it is not "you're
    // offline", and telling the user to check their connection would send them hunting
    // for a problem that isn't there.
    expect(classifyNetworkError(new Error('net::ERR_CERT_DATE_INVALID'))).toBe('unknown');
  });

  it('classifies Node errno shapes', () => {
    expect(classifyNetworkError({ code: 'ENOTFOUND' })).toBe('offline');
    expect(classifyNetworkError({ code: 'ECONNREFUSED' })).toBe('offline');
    expect(classifyNetworkError({ code: 'EAI_AGAIN' })).toBe('offline');
    expect(classifyNetworkError({ code: 'ENETUNREACH' })).toBe('offline');
    expect(classifyNetworkError({ code: 'ETIMEDOUT' })).toBe('timeout');
  });

  it('classifies a getaddrinfo-style message with no code as offline', () => {
    expect(classifyNetworkError(new Error('getaddrinfo ENOTFOUND example.com'))).toBe('offline');
  });

  it('unwraps a nested cause (undici nests the real errno under fetch failed)', () => {
    const cause = Object.assign(new Error('request to https://example.com failed'), { code: 'ENOTFOUND' });
    const err = new Error('fetch failed', { cause });
    expect(classifyNetworkError(err)).toBe('offline');
  });

  it('unwraps cause even when the outer message does not itself say "fetch failed"', () => {
    const cause = Object.assign(new Error('inner'), { code: 'ECONNREFUSED' });
    const err = new Error('outer wrapper', { cause });
    expect(classifyNetworkError(err)).toBe('offline');
  });

  it('classifies an AbortError (name-based) as timeout', () => {
    const err = new Error('The operation was aborted');
    err.name = 'AbortError';
    expect(classifyNetworkError(err)).toBe('timeout');
  });

  it('classifies a TimeoutError (name-based) as timeout', () => {
    const err = new Error('timed out');
    err.name = 'TimeoutError';
    expect(classifyNetworkError(err)).toBe('timeout');
  });

  it('classifies the "Timed out after …" message our own fetch wrappers throw as timeout', () => {
    expect(classifyNetworkError(new Error('Timed out after 10000ms fetching https://overfast.example/heroes'))).toBe(
      'timeout',
    );
  });

  it('classifies Notion-style errors by status + code', () => {
    expect(classifyNetworkError({ status: 401, code: 'unauthorized' })).toBe('auth');
    expect(classifyNetworkError({ status: 403, code: 'restricted_resource' })).toBe('auth');
    expect(classifyNetworkError({ status: 404, code: 'object_not_found' })).toBe('notFound');
    expect(classifyNetworkError({ status: 503 })).toBe('server');
    expect(classifyNetworkError({ status: 500, code: 'internal_server_error' })).toBe('server');
  });

  it('classifies Notion codes without a numeric status the same way', () => {
    expect(classifyNetworkError({ code: 'unauthorized' })).toBe('auth');
    expect(classifyNetworkError({ code: 'object_not_found' })).toBe('notFound');
    expect(classifyNetworkError({ code: 'service_unavailable' })).toBe('server');
  });

  it('classifies the Notion SDK client-side timeout error shape', () => {
    const err = new Error('Request timed out');
    err.name = 'RequestTimeoutError';
    expect(classifyNetworkError(err)).toBe('timeout');
  });

  it('classifies an "HTTP <code> …" message from our own net.fetch wrappers by status', () => {
    expect(classifyNetworkError(new Error('HTTP 404 Not Found for https://overfast.example/maps'))).toBe('notFound');
    expect(classifyNetworkError(new Error('HTTP 401 Unauthorized for https://overfast.example/heroes'))).toBe('auth');
    expect(classifyNetworkError(new Error('HTTP 503 Service Unavailable for the GEP status feed'))).toBe('server');
  });

  it('classifies plain HTTP status objects', () => {
    expect(classifyNetworkError({ status: 401 })).toBe('auth');
    expect(classifyNetworkError({ status: 403 })).toBe('auth');
    expect(classifyNetworkError({ status: 404 })).toBe('notFound');
    expect(classifyNetworkError({ status: 500 })).toBe('server');
    expect(classifyNetworkError({ status: 599 })).toBe('server');
  });

  it('never throws and classifies null/undefined/primitives/plain objects as unknown', () => {
    expect(classifyNetworkError(null)).toBe('unknown');
    expect(classifyNetworkError(undefined)).toBe('unknown');
    expect(classifyNetworkError('a string')).toBe('unknown');
    expect(classifyNetworkError(42)).toBe('unknown');
    expect(classifyNetworkError({})).toBe('unknown');
  });

  it('classifies an unrecognized status/code combination as unknown rather than guessing', () => {
    expect(classifyNetworkError({ status: 418, code: 'im_a_teapot' })).toBe('unknown');
    expect(classifyNetworkError(new Error('something else entirely'))).toBe('unknown');
  });
});

describe('friendlyNetworkMessage', () => {
  const kinds = ['offline', 'timeout', 'auth', 'notFound', 'server', 'unknown'] as const;

  it('returns a non-empty string for every kind', () => {
    for (const kind of kinds) {
      expect(friendlyNetworkMessage(kind, 'sync to Notion').length).toBeGreaterThan(0);
    }
  });

  it('names the internet connection explicitly for offline', () => {
    expect(friendlyNetworkMessage('offline', 'update the hero and map list')).toMatch(/internet connection/i);
  });

  it('includes the action text verbatim for every kind', () => {
    const action = 'update the hero and map list';
    for (const kind of kinds) {
      expect(friendlyNetworkMessage(kind, action)).toContain(action);
    }
  });

  it('uses a different action phrase for a Notion export message', () => {
    expect(friendlyNetworkMessage('auth', 'sync to Notion')).toContain('sync to Notion');
  });
});
