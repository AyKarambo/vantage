import { describe, it, expect } from 'vitest';
import type { WebContents } from 'electron';
import { hardenWebContents } from '../src/main/dashboard/webContentsSecurity';

/**
 * In-memory WebContents double: records the window-open handler and the
 * navigation listeners so the policy can be exercised synchronously, with no
 * Electron runtime. Only the members `hardenWebContents` touches are modelled.
 */
function fakeWebContents() {
  type OpenHandler = () => { action: string };
  type NavListener = (event: { preventDefault(): void }, ...rest: unknown[]) => void;
  const impl = {
    openHandler: undefined as OpenHandler | undefined,
    navListeners: new Map<string, NavListener[]>(),
    setWindowOpenHandler(handler: OpenHandler) {
      impl.openHandler = handler;
    },
    on(channel: string, listener: NavListener) {
      const list = impl.navListeners.get(channel) ?? [];
      list.push(listener);
      impl.navListeners.set(channel, list);
      return impl;
    },
    /** Fire a navigation event on `channel`; returns whether it was prevented. */
    emit(channel: string): boolean {
      let prevented = false;
      const event = { preventDefault: () => { prevented = true; } };
      for (const l of impl.navListeners.get(channel) ?? []) l(event);
      return prevented;
    },
  };
  return impl;
}

describe('hardenWebContents', () => {
  it('denies new windows / popups (H1)', () => {
    const wc = fakeWebContents();
    hardenWebContents(wc as unknown as WebContents);
    expect(wc.openHandler).toBeDefined();
    expect(wc.openHandler!()).toEqual({ action: 'deny' });
  });

  it('blocks in-window navigation (H2)', () => {
    const wc = fakeWebContents();
    hardenWebContents(wc as unknown as WebContents);
    expect(wc.emit('will-navigate')).toBe(true);
  });

  it('blocks server-side redirects (H3)', () => {
    const wc = fakeWebContents();
    hardenWebContents(wc as unknown as WebContents);
    expect(wc.emit('will-redirect')).toBe(true);
  });

  it('registers guards for both navigation channels', () => {
    const wc = fakeWebContents();
    hardenWebContents(wc as unknown as WebContents);
    expect(wc.navListeners.has('will-navigate')).toBe(true);
    expect(wc.navListeners.has('will-redirect')).toBe(true);
  });
});
