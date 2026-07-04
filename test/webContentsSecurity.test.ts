import { describe, it, expect } from 'vitest';
import type { WebContents } from 'electron';
import {
  hardenWebContents, isTrustedSenderUrl, isTrustedIpcEvent,
} from '../src/main/dashboard/webContentsSecurity';

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

describe('isTrustedSenderUrl', () => {
  it('accepts the app bundle in dev', () => {
    expect(isTrustedSenderUrl('file:///D:/source/vantage/renderer/index.html')).toBe(true);
  });

  it('accepts the app bundle inside a packed asar', () => {
    expect(isTrustedSenderUrl(
      'file:///C:/Users/x/AppData/Local/Programs/Vantage/resources/app.asar/renderer/index.html',
    )).toBe(true);
  });

  it('is case-insensitive on the path', () => {
    expect(isTrustedSenderUrl('file:///D:/x/RENDERER/INDEX.HTML')).toBe(true);
  });

  it('rejects a remote origin (wrong protocol)', () => {
    expect(isTrustedSenderUrl('https://evil.example/renderer/index.html')).toBe(false);
  });

  it('rejects another local page in the bundle', () => {
    expect(isTrustedSenderUrl('file:///D:/source/vantage/renderer/evil.html')).toBe(false);
  });

  it('rejects an unrelated local file', () => {
    expect(isTrustedSenderUrl('file:///etc/passwd')).toBe(false);
  });

  it('rejects a malformed / empty url', () => {
    expect(isTrustedSenderUrl('')).toBe(false);
    expect(isTrustedSenderUrl('not a url')).toBe(false);
  });
});

describe('isTrustedIpcEvent', () => {
  it('accepts an event from the app renderer frame', () => {
    expect(isTrustedIpcEvent({ senderFrame: { url: 'file:///x/renderer/index.html' } })).toBe(true);
  });

  it('rejects an event from a foreign frame', () => {
    expect(isTrustedIpcEvent({ senderFrame: { url: 'https://evil.example/' } })).toBe(false);
  });

  it('rejects an event with no sender frame', () => {
    expect(isTrustedIpcEvent({ senderFrame: null })).toBe(false);
  });
});
