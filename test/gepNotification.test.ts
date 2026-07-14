import { describe, it, expect } from 'vitest';
import { decideGepNotification } from '../src/core/gepService';
import type { ServiceStatus } from '../src/core/gepService';

const s = (level: ServiceStatus['level'], message?: string): ServiceStatus =>
  message ? { level, message } : { level };

describe('decideGepNotification', () => {
  it('fires a "down" notification on up → outage (once)', () => {
    const n = decideGepNotification(s('ok'), s('down', 'Events are disabled'));
    expect(n?.title).toBe('Overwatch events are down');
    expect(n?.body).toContain('Events are disabled');
    // degraded is also an outage
    expect(decideGepNotification(s('ok'), s('degraded'))?.title).toBe('Overwatch events are down');
  });

  it('fires a "restored" notification on outage → up', () => {
    expect(decideGepNotification(s('down'), s('ok'))?.title).toBe('Overwatch events restored');
    expect(decideGepNotification(s('degraded'), s('ok'))?.title).toBe('Overwatch events restored');
  });

  it('does not fire on an unchanged band (once per transition)', () => {
    expect(decideGepNotification(s('ok'), s('ok'))).toBeNull();
    expect(decideGepNotification(s('down'), s('down'))).toBeNull();
    expect(decideGepNotification(s('down'), s('degraded'))).toBeNull(); // both outage
    expect(decideGepNotification(s('degraded'), s('down'))).toBeNull();
  });

  it('never asserts an outage without evidence — unknown/absent transitions are silent', () => {
    expect(decideGepNotification(null, s('down'))).toBeNull();       // no prior baseline
    expect(decideGepNotification(s('unknown'), s('down'))).toBeNull();
    expect(decideGepNotification(s('down'), s('unknown'))).toBeNull(); // feed became unreachable
    expect(decideGepNotification(s('ok'), s('unknown'))).toBeNull();
    expect(decideGepNotification(undefined, s('ok'))).toBeNull();
  });
});
