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

  // Regression from a real false alarm. 10844_prod.json (Overwatch) serves
  // `published: false` with a blanket state 3 on all 25 keys, while 10844_dev.json
  // serves `published: true, state: 1`. The prod entry is an unpublished
  // placeholder, not an outage — reading it literally made the app announce a GEP
  // outage that was not happening.
  it('makes no claim from an unpublished entry, however red it looks', () => {
    expect(parseServiceStatus({ state: 3, published: false })).toEqual({ level: 'unknown' });
    // Red feature keys and a message don't rescue it — none of it is authoritative.
    expect(parseServiceStatus({
      state: 3,
      published: false,
      maintenance_msg: 'placeholder',
      features: [{ name: 'match_info', keys: [{ name: 'map', state: 3 }] }],
    })).toEqual({ level: 'unknown' });
  });

  it('still trusts a published entry, and one that omits the field', () => {
    // Valorant's real shape: published AND genuinely red.
    expect(parseServiceStatus({ state: 3, published: true })).toEqual({ level: 'down' });
    // A feed without the field at all must not be silently muted.
    expect(parseServiceStatus({ state: 3 })).toEqual({ level: 'down' });
  });

  it('keeps an explicit disable authoritative even on an unpublished entry', () => {
    expect(parseServiceStatus({ state: 3, published: false, disabled: true })).toEqual({ level: 'down' });
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
