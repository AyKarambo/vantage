import { ipcMain, type IpcMainInvokeEvent, type IpcMainEvent } from 'electron';
import { IPC_CHANNELS, WINDOW_CHANNELS } from '../../shared/contract';
import type { DataProvider } from './provider';
import { dashboardHandlers, type DashboardInvokers } from './handlers';
import { isTrustedIpcEvent } from './webContentsSecurity';

/**
 * IPC registration for the dashboard: each contract channel maps onto its entry
 * in the {@link dashboardHandlers} table (data) or a window-control closure (frameless title bar).
 * Mechanical glue only — behavior lives behind the provider. Registration is
 * process-global (ipcMain), so each function must be called exactly once.
 *
 * Every channel is registered through the `handle`/`on` wrappers below, which
 * reject any IPC that does not originate from the app's own renderer frame
 * (Electron security checklist #17 — defense-in-depth behind the narrow
 * preload). Signatures mirror Electron's own (`...args: any[]`) so the typed
 * call sites are unchanged.
 */
const rawHandle = ipcMain.handle.bind(ipcMain);
const rawOn = ipcMain.on.bind(ipcMain);

/** `ipcMain.handle` that rejects untrusted senders (the renderer's invoke rejects). */
function handle(
  channel: string,
  listener: (event: IpcMainInvokeEvent, ...args: any[]) => unknown,
): void {
  rawHandle(channel, (event, ...args) => {
    if (!isTrustedIpcEvent(event)) throw new Error(`Untrusted IPC sender on ${channel}`);
    return listener(event, ...args);
  });
}

/** `ipcMain.on` that silently drops untrusted senders (fire-and-forget channels). */
function on(
  channel: string,
  listener: (event: IpcMainEvent, ...args: any[]) => void,
): void {
  rawOn(channel, (event, ...args) => {
    if (!isTrustedIpcEvent(event)) return;
    listener(event, ...args);
  });
}

/** Wire every dashboard data channel to its handler. Call once per process. */
export function registerDashboardIpc(provider: DataProvider): void {
  const handlers = dashboardHandlers(provider) as Record<keyof DashboardInvokers, (...args: unknown[]) => unknown>;
  for (const [method, channel] of Object.entries(IPC_CHANNELS) as Array<[keyof DashboardInvokers, string]>) {
    handle(channel, (_e, ...args) => handlers[method](...args));
  }
}

/** Window actions the title-bar channels drive, provided as closures over the owning window. */
export interface WindowControls {
  /** Minimize the dashboard window. */
  minimize(): void;
  /** Maximize, or restore when already maximized. */
  toggleMaximize(): void;
  /** Close the dashboard window (the app keeps running in the tray). */
  close(): void;
}

/** Wire the title-bar window channels to the owning window's controls. Call once per process. */
export function registerWindowControls(controls: WindowControls): void {
  // Frameless window controls, driven by the custom title bar.
  on(WINDOW_CHANNELS.minimize, () => controls.minimize());
  on(WINDOW_CHANNELS.toggleMaximize, () => controls.toggleMaximize());
  on(WINDOW_CHANNELS.close, () => controls.close());
}
