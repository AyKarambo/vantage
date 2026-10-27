import type { EVENT_CHANNELS, OwStatsApi } from '../shared/contract';

/** A typed publish/subscribe hub: producers emit without knowing who listens, or whether anyone does yet. */
export interface EventHub<E> {
  emit<K extends keyof E>(event: K, payload: E[K]): void;
  /** Subscribe; returns the unsubscribe. */
  on<K extends keyof E>(event: K, listener: (payload: E[K]) => void): () => void;
}

export function createEventHub<E>(): EventHub<E> {
  const listeners = new Map<keyof E, Set<(payload: never) => void>>();
  return {
    emit: (event, payload) => {
      for (const listener of listeners.get(event) ?? []) (listener as (p: typeof payload) => void)(payload);
    },
    on: (event, listener) => {
      const set = listeners.get(event) ?? new Set();
      listeners.set(event, set);
      set.add(listener);
      return () => { set.delete(listener); };
    },
  };
}

/** Every renderer push, keyed like `EVENT_CHANNELS`, with the payload its `onX` subscription in the contract receives. */
export type PushEvents = {
  [K in keyof typeof EVENT_CHANNELS]: Parameters<Parameters<OwStatsApi[K]>[0]>[0];
};

/**
 * What happens in the main process: the renderer pushes, plus the settings
 * that must reach a running resource (the MCP pipe, the window's zoom) the
 * moment they change.
 */
export type AppEvents = PushEvents & {
  mcpEnabled: boolean;
  uiZoom: number;
};
