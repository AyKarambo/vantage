import { app, BrowserWindow, nativeImage, screen } from 'electron';
import * as path from 'path';
import type { WindowBounds } from '../config';
import type { DataProvider } from './provider';
import { registerDashboardIpc, registerWindowControls } from './ipcHandlers';
import { hardenWebContents } from './webContentsSecurity';
import { shouldEnableDevTools } from '../../core/devMode';
import { fitBounds, type Rect } from './windowBounds';

/**
 * The dashboard BrowserWindow lifecycle: a frameless, CSP-friendly window
 * loading the single renderer bundle, plus the one-time IPC registration
 * against its DataProvider. Main-process Electron edge — no domain logic here.
 */

// minWidth 960 (W7): exactly half a 1920px display, so Win+Left/Right
// snapping beside a windowed Overwatch or Discord can produce a fitting
// window on a 1080p monitor — the previous 1040 was wider than that half.
// The sidebar's own auto-collapse (SIDEBAR_NARROW_QUERY, shell.ts) triggers
// at 1180px, well above this floor, so the nav never becomes a keyhole
// between the two thresholds.
const WINDOW = { width: 1300, height: 840, minWidth: 960, minHeight: 640 };

/** Window-behavior hooks supplied by the composition root. */
export interface WindowUiDeps {
  /** ✕ keeps the app in the tray (true) or quits it (false). */
  closeToTray(): boolean;
  savedBounds(): WindowBounds | undefined;
  saveBounds(b: WindowBounds): void;
  /** Persisted text-size zoom factor (W7) — 1 = 100%; applied once the window has loaded. */
  zoomFactor(): number;
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

  /** Apply a text-size zoom factor to the live window now (W7); silently dropped when no window is open — the next `open()` reapplies the persisted value regardless. */
  setZoomFactor(factor: number): void {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.setZoomFactor(factor);
  }

  open(): void {
    if (this.win && !this.win.isDestroyed()) {
      if (this.win.isMinimized()) this.win.restore();
      this.win.show();
      this.win.focus();
      return;
    }
    const saved = this.ui.savedBounds();
    // The display the SAVED bounds used to sit on (getDisplayMatching), or —
    // no saved bounds, or that display is gone (a monitor changed under us,
    // e.g. undocking) — the primary display. Either way fitBounds (W7) always
    // gets a real work area to clamp/center against, never a stale guess.
    const workArea = this.workAreaFor(saved);
    const fitted = fitBounds(saved, workArea, WINDOW);
    this.win = new BrowserWindow({
      ...WINDOW,
      x: fitted.x, y: fitted.y, width: fitted.width, height: fitted.height,
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
        // Overwolf QA blocker: packaged builds must not expose DevTools.
        devTools: shouldEnableDevTools(app.isPackaged),
      },
    });
    // Lock the renderer to its own bundle: deny popups and any navigation away
    // from the loaded page (defense-in-depth behind Guardrail 1). Registered
    // before loadFile — programmatic loads don't trip these guards.
    hardenWebContents(this.win.webContents);
    if (fitted.maximize) this.win.maximize();
    // The persisted text-size zoom (W7) — set on the webContents before load
    // so it's already in effect for the very first paint, not a visible jump
    // once the page finishes loading.
    this.win.webContents.setZoomFactor(this.ui.zoomFactor());
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

  /**
   * The work area {@link fitBounds} should clamp/center against (W7): the
   * display the saved bounds used to sit on, via Electron's own "best match"
   * (`getDisplayMatching` scores every display by overlap with the given
   * rect, so a partially-off-screen or since-rearranged position still
   * resolves sensibly) — or the primary display when there's nothing saved,
   * or `getDisplayMatching` itself throws (a monitor changed under us).
   */
  private workAreaFor(saved: WindowBounds | undefined): Rect {
    if (saved) {
      try {
        return screen.getDisplayMatching(saved).workArea;
      } catch {
        /* fall through to the primary display */
      }
    }
    return screen.getPrimaryDisplay().workArea;
  }
}
