import { app, BrowserWindow, ipcMain, nativeImage } from 'electron';
import * as path from 'path';
import {
  byAccount, byHero, byMap, byRole, focusBy, heroStats, trend, winLoss,
  type GameRecord,
} from '../core/analytics';

export interface DashboardFilters {
  account?: string; // 'all' or account name
  role?: string; // 'all' | tank | damage | support | openQ
  days?: number | 'all';
}

export interface DataProvider {
  games(): GameRecord[];
  isSample(): boolean;
  exportToNotion?(
    games: GameRecord[],
  ): Promise<{ ok: number; failed: number; skipped?: number; unavailable?: boolean }>;
}

/** Owns the dashboard BrowserWindow and answers its data requests. */
export class DashboardWindow {
  private win?: BrowserWindow;

  constructor(
    private readonly provider: DataProvider,
    private readonly iconPath: string,
  ) {
    ipcMain.handle('dashboard:data', (_e, filters: DashboardFilters) =>
      computeDashboard(this.provider.games(), filters ?? {}, this.provider.isSample()),
    );
    ipcMain.handle('dashboard:export-notion', async (_e, filters: DashboardFilters) => {
      if (!this.provider.exportToNotion) return { ok: 0, failed: 0, unavailable: true };
      return this.provider.exportToNotion(applyFilters(this.provider.games(), filters ?? {}));
    });
  }

  open(): void {
    if (this.win && !this.win.isDestroyed()) {
      this.win.show();
      this.win.focus();
      return;
    }
    this.win = new BrowserWindow({
      width: 1240,
      height: 840,
      minWidth: 940,
      minHeight: 640,
      title: 'Overwatch Stats',
      backgroundColor: '#0f1216',
      autoHideMenuBar: true,
      icon: nativeImage.createFromPath(this.iconPath),
      webPreferences: {
        preload: path.join(app.getAppPath(), 'dist', 'main', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    void this.win.loadFile(path.join(app.getAppPath(), 'renderer', 'dashboard.html'));
    this.win.on('closed', () => (this.win = undefined));
  }
}

// --- data computation -------------------------------------------------------

export function computeDashboard(all: GameRecord[], filters: DashboardFilters, isSample: boolean) {
  const games = applyFilters(all, filters);
  const overall = winLoss(games);
  const weekly = (filters.days ?? 30) === 'all' || (filters.days as number) > 90;

  return {
    isSample,
    generatedAt: Date.now(),
    filters: {
      account: filters.account ?? 'all',
      role: filters.role ?? 'all',
      days: filters.days ?? 30,
    },
    options: {
      accounts: distinct(all.map((g) => g.account)).sort(),
      roles: distinct(all.map((g) => g.role)),
    },
    overall,
    streak: currentStreak(games),
    byRole: byRole(games),
    byAccount: byAccount(games),
    byMap: byMap(games),
    byHero: byHero(games).filter((h) => h.games >= 2).slice(0, 14),
    trend: trend(games, weekly ? 'week' : 'day'),
    focusMaps: focusBy(games, (g) => g.map).slice(0, 6),
    focusRoles: focusBy(games, (g) => g.role, 1),
    heroStats: heroStats(games).filter((h) => h.games >= 2).slice(0, 16),
  };
}

export function applyFilters(games: GameRecord[], f: DashboardFilters): GameRecord[] {
  let out = games;
  if (f.account && f.account !== 'all') out = out.filter((g) => g.account === f.account);
  if (f.role && f.role !== 'all') out = out.filter((g) => g.role === f.role);
  if (f.days && f.days !== 'all') {
    const cutoff = Date.now() - (f.days as number) * 86400000;
    out = out.filter((g) => g.timestamp >= cutoff);
  }
  return out;
}

/** Current win/loss streak from the most recent decided games. */
function currentStreak(games: GameRecord[]): { type: 'W' | 'L' | 'none'; count: number } {
  const decided = [...games].filter((g) => g.result !== 'Draw').sort((a, b) => b.timestamp - a.timestamp);
  if (!decided.length) return { type: 'none', count: 0 };
  const type = decided[0].result === 'Win' ? 'W' : 'L';
  let count = 0;
  for (const g of decided) {
    if ((g.result === 'Win' ? 'W' : 'L') === type) count++;
    else break;
  }
  return { type, count };
}

const distinct = <T>(arr: T[]): T[] => [...new Set(arr)];
