import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, WINDOW_CHANNELS, type OwStatsApi } from '../shared/contract';

/**
 * Minimal, safe bridge exposed to the dashboard renderer. Every contract
 * method forwards its arguments verbatim to its channel from `IPC_CHANNELS`,
 * so this file never needs to change when the API grows.
 */
const invokers = Object.fromEntries(
  Object.entries(IPC_CHANNELS).map(([method, channel]) => [
    method,
    (...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
  ]),
) as Omit<OwStatsApi, 'window'>;

const api: OwStatsApi = {
  ...invokers,
  window: {
    minimize: () => ipcRenderer.send(WINDOW_CHANNELS.minimize),
    toggleMaximize: () => ipcRenderer.send(WINDOW_CHANNELS.toggleMaximize),
    close: () => ipcRenderer.send(WINDOW_CHANNELS.close),
  },
};

contextBridge.exposeInMainWorld('owstats', api);
