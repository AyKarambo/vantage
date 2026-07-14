import { describe, it, expect } from 'vitest';
import { decideGepNotification, nextNotifyBaseline } from '../src/core/gepService';
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

describe('nextNotifyBaseline — carries the last authoritative reading across unknown', () => {
  it('keeps the prior band across an unknown blip, advances on an authoritative reading', () => {
    expect(nextNotifyBaseline(s('down'), s('unknown'))).toEqual(s('down'));
    expect(nextNotifyBaseline(s('ok'), s('unknown'))).toEqual(s('ok'));
    expect(nextNotifyBaseline(s('down'), s('ok'))).toEqual(s('ok'));
    expect(nextNotifyBaseline(null, s('unknown'))).toBeNull();
  });

  it('down → unknown → ok still fires the recovery notification (transient failure never masks it)', () => {
    let baseline: ServiceStatus | null = s('ok'); // feed was green (first poll established this)
    // outage detected
    let note = decideGepNotification(baseline, s('down'));
    baseline = nextNotifyBaseline(baseline, s('down'));
    expect(note?.title).toBe('Overwatch events are down');
    // transient feed hiccup — no notification, baseline preserved
    note = decideGepNotification(baseline, s('unknown'));
    baseline = nextNotifyBaseline(baseline, s('unknown'));
    expect(note).toBeNull();
    expect(baseline).toEqual(s('down'));
    // recovery — fires "restored" against the carried 'down'
    note = decideGepNotification(baseline, s('ok'));
    baseline = nextNotifyBaseline(baseline, s('ok'));
    expect(note?.title).toBe('Overwatch events restored');
  });
});
