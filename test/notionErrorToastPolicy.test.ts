import { describe, it, expect, vi } from 'vitest';

// `src/main/index.ts` is the main-process composition root: it imports the
// real `electron` module at its top level and, outside any function, runs
// `if (!app.requestSingleInstanceLock()) { app.quit(); } else { ...starts the
// app... }`. This test only wants `shouldToastNetError` — the small, pure
// policy the onError wiring (~line 261) was changed to use — so `electron`
// is stubbed with a generic no-op Proxy and `requestSingleInstanceLock` is
// forced to `false`. That takes the `else` branch (which calls `main()`,
// constructing every real service) out of play entirely: importing the
// module only evaluates its top-level declarations, never boots the app.
// This is the "test the predicate/wiring you introduce, not Electron itself"
// approach — no Electron runtime, window, tray, or service is ever touched.
vi.mock('electron', () => {
  const noop = () => {};
  // Any property access/call on the stub yields another callable stub, so
  // whatever incidental shape some transitively-imported module expects off
  // `electron` (Tray, BrowserWindow, ipcMain, safeStorage, …) resolves to an
  // inert no-op instead of throwing — none of those modules invoke anything
  // at their own module top level (only inside functions/class methods that
  // never run here), so this only needs to not crash on mere import.
  const makeProxy = (): any =>
    new Proxy(function stub() {}, {
      get: (_t, prop) => (prop === 'then' ? undefined : makeProxy()),
      apply: () => makeProxy(),
      construct: () => makeProxy(),
    });
  return {
    app: {
      requestSingleInstanceLock: () => false, // → app.quit(); main() never runs.
      quit: noop,
      setAppUserModelId: noop,
      on: noop,
      whenReady: () => ({ then: () => ({ catch: noop }) }),
      getPath: () => '/tmp/vantage-test',
      getLoginItemSettings: () => ({ openAtLogin: false }),
      setLoginItemSettings: noop,
    },
    shell: makeProxy(),
    dialog: makeProxy(),
    net: makeProxy(),
    safeStorage: makeProxy(),
    Tray: class {},
    Menu: { buildFromTemplate: () => ({}) },
    Notification: class {
      static isSupported() {
        return false;
      }
      show() {}
    },
    nativeImage: makeProxy(),
    clipboard: makeProxy(),
    BrowserWindow: class {},
    screen: makeProxy(),
    ipcMain: makeProxy(),
    contextBridge: makeProxy(),
    ipcRenderer: makeProxy(),
  };
});

import { shouldToastNetError } from '../src/main/index';

describe('shouldToastNetError — the composition root\'s onError toast policy (AC-5: no ambush on an offline launch)', () => {
  it('suppresses the toast for transport failures: offline, timeout, server', () => {
    expect(shouldToastNetError('offline')).toBe(false);
    expect(shouldToastNetError('timeout')).toBe(false);
    expect(shouldToastNetError('server')).toBe(false);
  });

  it('still toasts for real, actionable outcomes: auth, notFound', () => {
    expect(shouldToastNetError('auth')).toBe(true);
    expect(shouldToastNetError('notFound')).toBe(true);
  });

  it('still toasts an unclassified failure (kind omitted), matching pre-fix behavior for anything not network-shaped', () => {
    expect(shouldToastNetError('unknown')).toBe(true);
    expect(shouldToastNetError(undefined)).toBe(true);
  });
});
