/**
 * Renderer-side mirror of the main process's dev-mode authentication status:
 * one snapshot pull at startup (and on window focus, in case pushes were
 * dropped while the window was closed), then live updates over the push
 * channel. The shell's status-bar indicator renders from this.
 */
import type { DevModeAuthStatusPayload } from '../../src/shared/contract';
import { bridge } from './bridge';

type Listener = (s: DevModeAuthStatusPayload | null) => void;

let current: DevModeAuthStatusPayload | null = null;
const listeners = new Set<Listener>();
let started = false;

function set(s: DevModeAuthStatusPayload): void {
  current = s;
  for (const fn of listeners) fn(current);
}

/** Start the feed (idempotent). Call once from the shell. */
export function initDevModeAuthStatus(): void {
  if (started) return;
  started = true;
  const pull = (): void => {
    bridge.getDevModeAuthStatus().then(set).catch(() => {
      /* status stays unknown until the next pull/push */
    });
  };
  pull();
  bridge.onDevModeAuthStatus(set);
  window.addEventListener('focus', pull);
}

export function getDevModeAuthStatus(): DevModeAuthStatusPayload | null {
  return current;
}

export function subscribeDevModeAuthStatus(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
