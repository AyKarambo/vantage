import { app, BrowserWindow, ipcMain, nativeImage } from 'electron';
import * as path from 'path';
import { heroDetail, type GameRecord } from '../core/analytics';
import { computeDashboard, applyFilters } from '../core/dashboardData';
import type { AuthoredTarget } from '../core/targets';
import type {
  AuthoredTargetInput, DashboardFilters, HeroDetail, ManualMatchInput, NotionStatus,
} from '../shared/contract';

export type { DashboardFilters } from '../shared/contract';
export { computeDashboard, applyFilters } from '../core/dashboardData';

export interface DataProvider {
  games(): GameRecord[];
  isSample(): boolean;
  exportToNotion?(
    games: GameRecord[],
  ): Promise<{ ok: number; failed: number; skipped?: number; unavailable?: boolean }>;
  /** Current Notion connection state (for the Notion sync screen). */
  notionStatus(): NotionStatus;
  /** Save an integration token, (re)build the client, return the new state. */
  setNotionToken(token: string): NotionStatus;
  /** Remove the saved token and return the new state. */
  clearNotionToken(): NotionStatus;
  /** The player's authored improvement targets (◎ manual). */
  manualTargets(): AuthoredTarget[];
  /** Persist a new authored target. */
  saveTarget(input: AuthoredTargetInput): void;
  /** Persist a manually-logged match; returns its new id. */
  logMatch(input: ManualMatchInput): { matchId: string };
}

const WINDOW = { width: 1300, height: 840, minWidth: 1040, minHeight: 640 };

/** Owns the dashboard BrowserWindow and answers its data + window requests. */
export class DashboardWindow {
  private win?: BrowserWindow;

  constructor(
    private readonly provider: DataProvider,
    private readonly iconPath: string,
  ) {
    ipcMain.handle('dashboard:data', (_e, filters: DashboardFilters) =>
      computeDashboard(this.provider.games(), filters ?? {}, this.provider.isSample(), {
        targets: this.provider.manualTargets(),
      }),
    );
    ipcMain.handle('dashboard:export-notion', async (_e, filters: DashboardFilters) => {
      if (!this.provider.exportToNotion) return { ok: 0, failed: 0, unavailable: true };
      return this.provider.exportToNotion(applyFilters(this.provider.games(), filters ?? {}));
    });
    ipcMain.handle('dashboard:hero-detail', (_e, hero: string, filters: DashboardFilters) =>
      heroDetail(applyFilters(this.provider.games(), filters ?? {}), hero),
    );

    // Notion sync screen.
    ipcMain.handle('notion:status', () => this.provider.notionStatus());
    ipcMain.handle('notion:set-token', (_e, token: string) => this.provider.setNotionToken(token));
    ipcMain.handle('notion:clear-token', () => this.provider.clearNotionToken());

    // Manual (◎) writes.
    ipcMain.handle('manual:log-match', (_e, input: ManualMatchInput) => this.provider.logMatch(input));
    ipcMain.handle('manual:save-target', (_e, input: AuthoredTargetInput) => {
      this.provider.saveTarget(input);
    });

    // Frameless window controls, driven by the custom title bar.
    ipcMain.on('window:minimize', () => this.win?.minimize());
    ipcMain.on('window:toggle-maximize', () => {
      if (!this.win) return;
      this.win.isMaximized() ? this.win.unmaximize() : this.win.maximize();
    });
    ipcMain.on('window:close', () => this.win?.close());
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

// Re-export for the drill-down handler's return type.
export type { HeroDetail };
