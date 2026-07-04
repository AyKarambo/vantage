import { app, BrowserWindow, ipcMain, nativeImage } from 'electron';
import * as path from 'path';
import { heroDetail, type GameRecord } from '../core/analytics';
import { matchDetail } from '../core/matchDetail';
import { computeDashboard, applyFilters } from '../core/dashboardData';
import type { AuthoredTarget } from '../core/targets';
import type { BreakReminderSettings } from '../core/breakReminder';
import { IPC_CHANNELS, WINDOW_CHANNELS } from '../shared/contract';
import type {
  AuthoredTargetInput, DashboardFilters, HeroDetail, ManualMatchInput, NotionStatus,
  NotionDatabaseSummary, NotionPageSummary, ReviewInput, TargetEditInput,
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
  /** Attach a Review-screen read (grades + flags) to a tracked match. */
  saveReview(input: ReviewInput): void;
  /** Bulk legacy-review import; skips unknown ids and already-reviewed games. */
  importReviews(inputs: ReviewInput[]): { imported: number; skipped: number };
  /** Edit a target's name/mode/rule, preserving lifecycle state + accrued grades. */
  updateTarget(input: TargetEditInput): void;
  /** Toggle whether the target is graded on the Review screen. */
  setTargetActive(id: string, active: boolean): void;
  /** Archive (restorable) or restore a target. */
  setTargetArchived(id: string, archived: boolean): void;
  /** Permanently remove a target. */
  deleteTarget(id: string): void;
  /** Current break-reminder settings. */
  getBreakReminder(): BreakReminderSettings;
  /** Persist new break-reminder settings; returns the persisted (clamped) value. */
  setBreakReminder(input: BreakReminderSettings): BreakReminderSettings;
  /** Databases the Notion integration can see, for the picker. */
  listNotionDatabases(): Promise<{ databases: NotionDatabaseSummary[]; error?: string }>;
  /** Pages the Notion integration can see — candidate parents for auto-create. */
  listNotionPages(): Promise<{ pages: NotionPageSummary[]; error?: string }>;
  /** Select an existing database as the Gametracker target. */
  selectNotionDatabase(databaseId: string): Promise<NotionStatus>;
  /** Create a correctly-shaped Maps + Gametracker database pair under a parent page, then select it. */
  createNotionDatabase(parentPageId: string): Promise<NotionStatus>;
}

const WINDOW = { width: 1300, height: 840, minWidth: 1040, minHeight: 640 };

/** Owns the dashboard BrowserWindow and answers its data + window requests. */
export class DashboardWindow {
  private win?: BrowserWindow;

  constructor(
    private readonly provider: DataProvider,
    private readonly iconPath: string,
  ) {
    const ch = IPC_CHANNELS;
    ipcMain.handle(ch.getDashboard, (_e, filters: DashboardFilters) =>
      computeDashboard(this.provider.games(), filters ?? {}, this.provider.isSample(), {
        targets: this.provider.manualTargets(),
        breakReminder: this.provider.getBreakReminder(),
      }),
    );
    ipcMain.handle(ch.exportNotion, async (_e, filters: DashboardFilters) => {
      if (!this.provider.exportToNotion) return { ok: 0, failed: 0, unavailable: true };
      return this.provider.exportToNotion(applyFilters(this.provider.games(), filters ?? {}));
    });
    ipcMain.handle(ch.heroDetail, (_e, hero: string, filters: DashboardFilters) =>
      heroDetail(applyFilters(this.provider.games(), filters ?? {}), hero),
    );
    // Looked up in the full history (a row must open even after filters move
    // on); the competitive estimate is scoped to the current filter set.
    ipcMain.handle(ch.matchDetail, (_e, matchId: string, filters: DashboardFilters) => {
      const games = this.provider.games();
      return matchDetail(games, matchId, applyFilters(games, filters ?? {}));
    });

    // Notion sync screen.
    ipcMain.handle(ch.notionStatus, () => this.provider.notionStatus());
    ipcMain.handle(ch.setNotionToken, (_e, token: string) => this.provider.setNotionToken(token));
    ipcMain.handle(ch.clearNotionToken, () => this.provider.clearNotionToken());
    ipcMain.handle(ch.listNotionDatabases, () => this.provider.listNotionDatabases());
    ipcMain.handle(ch.listNotionPages, () => this.provider.listNotionPages());
    ipcMain.handle(ch.selectNotionDatabase, (_e, databaseId: string) =>
      this.provider.selectNotionDatabase(databaseId),
    );
    ipcMain.handle(ch.createNotionDatabase, (_e, parentPageId: string) =>
      this.provider.createNotionDatabase(parentPageId),
    );

    // Manual (◎) writes.
    ipcMain.handle(ch.logMatch, (_e, input: ManualMatchInput) => this.provider.logMatch(input));
    ipcMain.handle(ch.saveTarget, (_e, input: AuthoredTargetInput) => {
      this.provider.saveTarget(input);
    });
    ipcMain.handle(ch.saveReview, (_e, input: ReviewInput) => {
      this.provider.saveReview(input);
    });
    ipcMain.handle(ch.importReviews, (_e, inputs: ReviewInput[]) =>
      this.provider.importReviews(inputs),
    );
    ipcMain.handle(ch.updateTarget, (_e, input: TargetEditInput) => {
      this.provider.updateTarget(input);
    });
    ipcMain.handle(ch.setTargetActive, (_e, id: string, active: boolean) => {
      this.provider.setTargetActive(id, active);
    });
    ipcMain.handle(ch.setTargetArchived, (_e, id: string, archived: boolean) => {
      this.provider.setTargetArchived(id, archived);
    });
    ipcMain.handle(ch.deleteTarget, (_e, id: string) => {
      this.provider.deleteTarget(id);
    });

    // Break-reminder settings.
    ipcMain.handle(ch.getBreakReminder, () => this.provider.getBreakReminder());
    ipcMain.handle(ch.setBreakReminder, (_e, input: BreakReminderSettings) =>
      this.provider.setBreakReminder(input),
    );

    // Frameless window controls, driven by the custom title bar.
    ipcMain.on(WINDOW_CHANNELS.minimize, () => this.win?.minimize());
    ipcMain.on(WINDOW_CHANNELS.toggleMaximize, () => {
      if (!this.win) return;
      this.win.isMaximized() ? this.win.unmaximize() : this.win.maximize();
    });
    ipcMain.on(WINDOW_CHANNELS.close, () => this.win?.close());
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
