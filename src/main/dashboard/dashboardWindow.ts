import { app, BrowserWindow, nativeImage, screen } from 'electron';
import * as path from 'path';
import type { WindowBounds } from '../config';
import type { DataProvider } from './provider';
import { registerDashboardIpc, registerWindowControls } from './ipcHandlers';
import { hardenWebContents } from './webContentsSecurity';

/**
 * The dashboard BrowserWindow lifecycle: a frameless, CSP-friendly window
 * loading the single renderer bundle, plus the one-time IPC registration
 * against its DataProvider. Main-process Electron edge — no domain logic here.
 */

const WINDOW = { width: 1300, height: 840, minWidth: 1040, minHeight: 640 };

/** Window-behavior hooks supplied by the composition root. */
export interface WindowUiDeps {
  /** ✕ keeps the app in the tray (true) or quits it (false). */
  closeToTray(): boolean;
  savedBounds(): WindowBounds | undefined;
  saveBounds(b: WindowBounds): void;
}

/** Owns the dashboard BrowserWindow and answers its data + window requests. */
export class DashboardWindow {
  private win?: BrowserWindow;
  private boundsTimer?: NodeJS.Timeout;

  /** Construct once — IPC registration is process-global. */
  constructor(
    private readonly provider: DataProvider,
    private readonly iconPath: string,
    private readonly ui: WindowUiDeps,
  ) {
    registerDashboardIpc(provider);
    registerWindowControls({
      minimize: () => this.win?.minimize(),
      toggleMaximize: () => {
        if (!this.win) return;
        this.win.isMaximized() ? this.win.unmaximize() : this.win.maximize();
      },
      close: () => {
        this.win?.close();
        if (!this.ui.closeToTray()) app.quit();
      },
    });
  }

  /** Push an event payload to the renderer; silently dropped when no window is open. */
  push(channel: string, payload: unknown): void {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send(channel, payload);
  }

  open(): void {
    if (this.win && !this.win.isDestroyed()) {
      if (this.win.isMinimized()) this.win.restore();
      this.win.show();
      this.win.focus();
      return;
    }
    const saved = this.restorableBounds();
    this.win = new BrowserWindow({
      ...WINDOW,
      ...(saved ? { x: saved.x, y: saved.y, width: saved.width, height: saved.height } : {}),
      title: 'Vantage',
      // Overwolf-compliant frameless desktop app with its own title bar.
      frame: false,
      backgroundColor: '#0b0b0f',
      autoHideMenuBar: true,
      icon: nativeImage.createFromPath(this.iconPath),
      webPreferences: {
        preload: path.join(app.getAppPath(), 'dist', 'main', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    // Lock the renderer to its own bundle: deny popups and any navigation away
    // from the loaded page (defense-in-depth behind Guardrail 1). Registered
    // before loadFile — programmatic loads don't trip these guards.
    hardenWebContents(this.win.webContents);
    if (saved?.maximized) this.win.maximize();
    void this.win.loadFile(path.join(app.getAppPath(), 'renderer', 'index.html'));
    const debouncedSave = (): void => {
      clearTimeout(this.boundsTimer);
      this.boundsTimer = setTimeout(() => this.persistBounds(), 500);
    };
    this.win.on('resize', debouncedSave);
    this.win.on('move', debouncedSave);
    this.win.on('close', () => this.persistBounds());
    this.win.on('closed', () => (this.win = undefined));
  }

  private persistBounds(): void {
    if (!this.win || this.win.isDestroyed()) return;
    const b = this.win.getNormalBounds();
    this.ui.saveBounds({
      x: b.x, y: b.y, width: b.width, height: b.height, maximized: this.win.isMaximized(),
    });
  }

  /** Saved placement, only if it still lands on a connected display. */
  private restorableBounds(): WindowBounds | undefined {
    const saved = this.ui.savedBounds();
    if (!saved) return undefined;
    try {
      const area = screen.getDisplayMatching(saved).workArea;
      const intersects =
        saved.x < area.x + area.width && saved.x + saved.width > area.x &&
        saved.y < area.y + area.height && saved.y + saved.height > area.y;
      if (!intersects) return undefined;
      return {
        ...saved,
        width: Math.max(WINDOW.minWidth, saved.width),
        height: Math.max(WINDOW.minHeight, saved.height),
      };
    } catch {
      return undefined; // a monitor changed under us — fall back to defaults
    }
  }
}
