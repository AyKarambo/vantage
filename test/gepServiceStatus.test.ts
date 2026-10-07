import { describe, it, expect } from 'vitest';
import { parseServiceStatus } from '../src/core/gepService';

describe('parseServiceStatus — Overwolf status feed', () => {
  it('maps the top-level state code to a level', () => {
    expect(parseServiceStatus({ state: 1 })).toEqual({ level: 'ok' });
    expect(parseServiceStatus({ state: 2 })).toEqual({ level: 'degraded' });
    expect(parseServiceStatus({ state: 3 })).toEqual({ level: 'down' });
    expect(parseServiceStatus({ state: 0 })).toEqual({ level: 'unknown' }); // unsupported
  });

  it('treats an explicit disable as down regardless of state', () => {
    expect(parseServiceStatus({ state: 1, disabled: true })).toEqual({ level: 'down' });
    expect(parseServiceStatus({ state: 1, disabled_electron: true })).toEqual({ level: 'down' });
  });

  it('carries maintenance_msg when not ok, omits it when ok', () => {
    expect(parseServiceStatus({ state: 3, maintenance_msg: 'Events are disabled' }))
      .toEqual({ level: 'down', message: 'Events are disabled' });
    // ok never carries a message (nothing to explain)
    expect(parseServiceStatus({ state: 1, maintenance_msg: 'stale note' })).toEqual({ level: 'ok' });
  });

  it('lets a degraded feature key worsen an ok top-level state, but never upgrade a down one', () => {
    const feat = (s: number) => ({ features: [{ keys: [{ state: s }] }] });
    expect(parseServiceStatus({ state: 1, ...feat(2) })).toEqual({ level: 'degraded' });
    expect(parseServiceStatus({ state: 1, ...feat(3) })).toEqual({ level: 'down' });
    // top-level down stays down even if a feature reads ok
    expect(parseServiceStatus({ state: 3, ...feat(1) })).toEqual({ level: 'down' });
  });

  it('never throws — unreadable/garbage input becomes unknown (no outage claim)', () => {
    expect(parseServiceStatus(null)).toEqual({ level: 'unknown' });
    expect(parseServiceStatus('nope')).toEqual({ level: 'unknown' });
    expect(parseServiceStatus({})).toEqual({ level: 'unknown' });
    expect(parseServiceStatus({ state: 'green' })).toEqual({ level: 'unknown' });
    expect(parseServiceStatus({ state: 1, features: 'broken' })).toEqual({ level: 'ok' }); // guarded
  });

  it('parses a realistic green 10844_prod.json shape as ok', () => {
    const raw = {
      game_id: 10844, state: 1, published: true, disabled: false, disabled_electron: false,
      features: [
        { name: 'match_info', keys: [{ name: 'match_info', state: 1 }] },
        { name: 'roster', keys: [{ name: 'roster', state: 1 }] },
      ],
    };
    expect(parseServiceStatus(raw)).toEqual({ level: 'ok' });
  });
});

describe('parseServiceStatus — minimum GEP version', () => {
  it('reads min_gep_version_electron, falling back to min_gep_version', () => {
    expect(parseServiceStatus({ state: 3, min_gep_version_electron: '315.0.2', min_gep_version: '300.0.0' }))
      .toEqual({ level: 'down', minGepVersion: '315.0.2' });
    expect(parseServiceStatus({ state: 1, min_gep_version: '309.1.0' }))
      .toEqual({ level: 'ok', minGepVersion: '309.1.0' });
  });

  it('ignores an unreadable version and never attaches one to an unknown reading', () => {
    expect(parseServiceStatus({ state: 1, min_gep_version_electron: 'latest' })).toEqual({ level: 'ok' });
    expect(parseServiceStatus({ state: 1, min_gep_version_electron: 315 })).toEqual({ level: 'ok' });
    expect(parseServiceStatus({ min_gep_version_electron: '315.0.2' })).toEqual({ level: 'unknown' });
  });

  it('keeps the version on an explicit disable', () => {
    expect(parseServiceStatus({ state: 1, disabled_electron: true, min_gep_version_electron: '315.0.2' }))
      .toEqual({ level: 'down', minGepVersion: '315.0.2' });
  });
});
