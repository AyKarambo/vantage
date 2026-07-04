import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { EVENT_CHANNELS, IPC_CHANNELS, WINDOW_CHANNELS, type OwStatsApi } from '../shared/contract';

/**
 * Minimal, safe bridge exposed to the dashboard renderer. Every contract
 * method forwards its arguments verbatim to its channel from `IPC_CHANNELS`,
 * and every `onX` subscription is generated from `EVENT_CHANNELS`, so this
 * file never needs to change when the API grows.
 */
const invokers = Object.fromEntries(
  Object.entries(IPC_CHANNELS).map(([method, channel]) => [
    method,
    (...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
  ]),
) as Omit<OwStatsApi, 'window' | keyof typeof EVENT_CHANNELS>;

const subscribers = Object.fromEntries(
  Object.entries(EVENT_CHANNELS).map(([method, channel]) => [
    method,
    (cb: (payload: unknown) => void) => {
      const listener = (_e: IpcRendererEvent, payload: unknown): void => cb(payload);
      ipcRenderer.on(channel, listener);
      return () => {
        ipcRenderer.removeListener(channel, listener);
      };
    },
  ]),
) as unknown as Pick<OwStatsApi, keyof typeof EVENT_CHANNELS>;

const api: OwStatsApi = {
  ...invokers,
  ...subscribers,
  window: {
    minimize: () => ipcRenderer.send(WINDOW_CHANNELS.minimize),
    toggleMaximize: () => ipcRenderer.send(WINDOW_CHANNELS.toggleMaximize),
    close: () => ipcRenderer.send(WINDOW_CHANNELS.close),
  },
};

contextBridge.exposeInMainWorld('owstats', api);
