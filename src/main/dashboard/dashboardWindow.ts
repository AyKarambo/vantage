import { app, BrowserWindow, nativeImage } from 'electron';
import * as path from 'path';
import type { DataProvider } from './provider';
import { registerDashboardIpc, registerWindowControls } from './ipcHandlers';

/**
 * The dashboard BrowserWindow lifecycle: a frameless, CSP-friendly window
 * loading the single renderer bundle, plus the one-time IPC registration
 * against its DataProvider. Main-process Electron edge — no domain logic here.
 */

const WINDOW = { width: 1300, height: 840, minWidth: 1040, minHeight: 640 };

/** Owns the dashboard BrowserWindow and answers its data + window requests. */
export class DashboardWindow {
  private win?: BrowserWindow;

  /** Construct once — IPC registration is process-global. */
  constructor(
    private readonly provider: DataProvider,
    private readonly iconPath: string,
  ) {
    registerDashboardIpc(provider);
    registerWindowControls({
      minimize: () => this.win?.minimize(),
      toggleMaximize: () => {
        if (!this.win) return;
        this.win.isMaximized() ? this.win.unmaximize() : this.win.maximize();
      },
      close: () => this.win?.close(),
    });
  }

  open(): void {
    if (this.win && !this.win.isDestroyed()) {
      if (this.win.isMinimized()) this.win.restore();
      this.win.show();
      this.win.focus();
      return;
    }
    this.win = new BrowserWindow({
      ...WINDOW,
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
      },
    });
    void this.win.loadFile(path.join(app.getAppPath(), 'renderer', 'index.html'));
    this.win.on('closed', () => (this.win = undefined));
  }
}
