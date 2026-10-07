import { describe, it, expect } from 'vitest';
import { createGepStatusMonitor } from '../src/main/gepStatusMonitor';
import type { GepStatusPayload } from '../src/shared/contract';

function harness() {
  const published: GepStatusPayload[] = [];
  const m = createGepStatusMonitor({
    sensor: 'gep',
    log: () => {},
    publish: (p) => published.push(p),
    now: () => 1000,
  });
  return { m, published };
}

describe('gepStatusMonitor — service status + staged-update dimensions', () => {
  it('publishes when only the service status changes, and dedups an unchanged one', () => {
    const { m, published } = harness();
    m.setServiceStatus({ level: 'down', message: 'Events are disabled' });
    expect(published.at(-1)?.serviceStatus).toBe('down');
    expect(published.at(-1)?.serviceMessage).toBe('Events are disabled');

    const n = published.length;
    m.setServiceStatus({ level: 'down', message: 'Events are disabled' }); // unchanged → no publish
    expect(published.length).toBe(n);

    m.setServiceStatus({ level: 'ok' }); // recovered → publish, message cleared
    expect(published.length).toBe(n + 1);
    expect(published.at(-1)?.serviceStatus).toBe('ok');
    expect(published.at(-1)?.serviceMessage).toBeUndefined();
  });

  it('publishes staged-update and package-version changes (deduped)', () => {
    const { m, published } = harness();
    m.setUpdateStaged(true);
    expect(published.at(-1)?.updateStaged).toBe(true);

    const n = published.length;
    m.setUpdateStaged(true); // unchanged → no publish
    expect(published.length).toBe(n);

    m.setGepPackageVersion('310.0.0');
    expect(published.at(-1)?.gepPackageVersion).toBe('310.0.0');
  });
});

describe('gepStatusMonitor — outdated GEP package', () => {
  it('flags outdated only when the loaded version is below the feed minimum, and dedups', () => {
    const { m, published } = harness();
    m.setGepPackageVersion('315.0.1');
    expect(published.at(-1)?.gepOutdated).toBeUndefined(); // no minimum known yet

    m.setServiceStatus({ level: 'down', minGepVersion: '315.0.2' });
    expect(published.at(-1)?.gepOutdated).toBe(true);
    expect(published.at(-1)?.gepMinVersion).toBe('315.0.2');

    const n = published.length;
    m.setServiceStatus({ level: 'down', minGepVersion: '315.0.2' }); // unchanged → no publish
    expect(published.length).toBe(n);

    m.setGepPackageVersion('315.0.2'); // the fix loaded
    expect(published.at(-1)?.gepOutdated).toBeUndefined();
  });

  it('keeps the warning through a transient unknown reading', () => {
    const { m, published } = harness();
    m.setGepPackageVersion('315.0.1');
    m.setServiceStatus({ level: 'down', minGepVersion: '315.0.2' });
    m.setServiceStatus({ level: 'unknown' }); // poller surrendered after repeated failures
    expect(published.at(-1)?.gepOutdated).toBe(true);
  });
});
