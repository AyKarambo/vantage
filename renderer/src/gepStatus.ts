/**
 * Renderer-side mirror of the main process's connection/data-flow status:
 * one snapshot pull at startup (and on window focus, in case pushes were
 * dropped while the window was closed), then live updates over the push
 * channel. The shell's status-bar indicator renders from this.
 */
import type { GepStatusPayload } from '../../src/shared/contract';
import { bridge } from './bridge';

type Listener = (s: GepStatusPayload | null) => void;

let current: GepStatusPayload | null = null;
const listeners = new Set<Listener>();
let started = false;

function set(s: GepStatusPayload): void {
  current = s;
  for (const fn of listeners) fn(current);
}

/** Start the feed (idempotent). Call once from the shell. */
export function initGepStatus(): void {
  if (started) return;
  started = true;
  const pull = (): void => {
    bridge.getGepStatus().then(set).catch(() => {
      /* status stays unknown until the next pull/push */
    });
  };
  pull();
  bridge.onGepStatus(set);
  window.addEventListener('focus', pull);
}

export function getGepStatus(): GepStatusPayload | null {
  return current;
}

export function subscribeGepStatus(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
