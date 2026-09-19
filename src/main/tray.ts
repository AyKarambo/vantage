import {
  Tray,
  Menu,
  Notification,
  nativeImage,
  clipboard,
  dialog,
  shell,
} from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import type { GepHealthState } from '../core/gepHealth';
import { liveTrayLabel, sessionTrayLabel } from '../core/trayStatus';

export interface TrayHandlers {
  onOpenDashboard(): void;
  onToggleAutoLaunch(enabled: boolean): void;
  onImportToken(token: string): void;
  onReloadConfig(): void;
  onOpenGametracker(): void;
  onOpenConfig(): void;
  onOpenSupport(): void;
  onQuit(): void;
}

export interface TrayState {
  status: string;
  autoLaunch: boolean;
  tokenSet: boolean;
  /** The in-progress match, when one is running (S5) — undefined the rest of the time. */
  live?: { map?: string; startedAt: number };
  /** The trailing gap-based sitting's W-L, when one is open (S5). */
  session?: { wins: number; losses: number };
}

/**
 * The single Windows tray icon + context menu and toast notifications.
 * There is no window and no in-game overlay — this is the entire visible surface.
 */
export class TrayController {
  private tray!: Tray;
  private state: TrayState = { status: 'Starting…', autoLaunch: false, tokenSet: false };
  private health: GepHealthState = 'no-game';
  private readonly healthIcons = new Map<GepHealthState, Electron.NativeImage>();

  constructor(
    private readonly iconPath: string,
    private readonly handlers: TrayHandlers,
  ) {}

  init(initial: Partial<TrayState>): void {
    this.state = { ...this.state, ...initial };
    this.tray = new Tray(this.icon());
    this.updateTooltip();
    this.tray.on('double-click', () => this.handlers.onOpenDashboard());
    this.rebuild();
  }

  setState(patch: Partial<TrayState>): void {
    this.state = { ...this.state, ...patch };
    this.rebuild();
  }

  /** Mirror the live connection state: swap the icon variant + tooltip. */
  setHealth(state: GepHealthState): void {
    if (!this.tray || state === this.health) return;
    this.health = state;
    const img = this.healthIcon(state);
    if (!img.isEmpty()) this.tray.setImage(img);
    this.updateTooltip();
  }

  /**
   * The hover tooltip: the connection health, plus the live-match and
   * current-sitting reads when either is present (S5) — folded in here so a
   * hover answers "what's Vantage doing right now" without opening the menu.
   * Called from both `rebuild()` (state changes) and `setHealth()`
   * (connection changes), so the two can never show it out of sync.
   */
  private updateTooltip(): void {
    if (!this.tray) return;
    const parts = [
      healthTooltip(this.health),
      liveTrayLabel(this.state.live, Date.now()),
      sessionTrayLabel(this.state.session),
    ].filter((s): s is string => s != null);
    this.tray.setToolTip(parts.join(' · '));
  }

  private healthIcon(state: GepHealthState): Electron.NativeImage {
    const cached = this.healthIcons.get(state);
    if (cached) return cached;
    const file = state === 'no-game'
      ? this.iconPath
      : path.join(path.dirname(this.iconPath), `tray-${state}.png`);
    let img = nativeImage.createEmpty();
    try {
      if (fs.existsSync(file)) img = nativeImage.createFromPath(file);
    } catch {
      /* keep empty — setHealth skips empty images */
    }
    this.healthIcons.set(state, img);
    return img;
  }

  notify(title: string, body: string): void {
    this.showToast(title, body);
  }

  notifyError(title: string, body: string): void {
    this.showToast(`⚠ ${title}`, body);
  }

  private showToast(title: string, body: string): void {
    if (!Notification.isSupported()) return;
    new Notification({ title, body, icon: this.icon(), silent: false }).show();
  }

  private icon(): Electron.NativeImage {
    try {
      if (fs.existsSync(this.iconPath)) {
        const img = nativeImage.createFromPath(this.iconPath);
        if (!img.isEmpty()) return img;
      }
    } catch {
      /* fall through to empty */
    }
    return nativeImage.createEmpty();
  }

  private rebuild(): void {
    this.updateTooltip();
    const liveLabel = liveTrayLabel(this.state.live, Date.now());
    const sessionLabel = sessionTrayLabel(this.state.session);
    const menu = Menu.buildFromTemplate([
      { label: 'Open Dashboard', click: () => this.handlers.onOpenDashboard() },
      { type: 'separator' },
      { label: this.state.status, enabled: false },
      // Live/session reads (S5) — only present while there's something to say;
      // clicking the live row opens the dashboard, same as the main item above
      // (there is no deep-link-to-a-screen IPC yet, so this lands wherever the
      // window already is rather than forcing a jump to Live specifically).
      ...(liveLabel ? [{ label: liveLabel, click: () => this.handlers.onOpenDashboard() }] : []),
      ...(sessionLabel ? [{ label: sessionLabel, enabled: false }] : []),
      { type: 'separator' },
      {
        label: this.state.tokenSet ? 'Notion token: set ✓' : 'Set Notion token (from clipboard)…',
        click: () => this.importTokenFromClipboard(),
      },
      { label: 'Open Gametracker in Notion', click: () => this.handlers.onOpenGametracker() },
      { type: 'separator' },
      {
        label: 'Run at login',
        type: 'checkbox',
        checked: this.state.autoLaunch,
        click: (item: Electron.MenuItem) => this.handlers.onToggleAutoLaunch(item.checked),
      },
      { label: 'Edit config (accounts, map aliases)…', click: () => this.handlers.onOpenConfig() },
      { label: 'Reload config', click: () => this.handlers.onReloadConfig() },
      { type: 'separator' },
      { label: 'Help & Support', click: () => this.handlers.onOpenSupport() },
      { label: 'Quit', click: () => this.handlers.onQuit() },
    ]);
    this.tray.setContextMenu(menu);
  }

  private importTokenFromClipboard(): void {
    const text = clipboard.readText().trim();
    const looksValid = /^(secret_|ntn_)/.test(text) && text.length > 20;
    if (!looksValid) {
      dialog.showMessageBoxSync({
        type: 'warning',
        title: 'Notion token',
        message: 'Clipboard does not contain a Notion integration token.',
        detail: 'Copy your token (starts with "ntn_" or "secret_") from notion.so/my-integrations, then click this item again.',
      });
      return;
    }
    this.handlers.onImportToken(text);
    dialog.showMessageBoxSync({
      type: 'info',
      title: 'Notion token',
      message: 'Notion token saved (encrypted).',
    });
  }

  /** Ensure a config file exists, then open it in the default editor. */
  openConfigFile(configPath: string, template: string): void {
    if (!fs.existsSync(configPath)) fs.writeFileSync(configPath, template, 'utf8');
    void shell.openPath(configPath);
  }

  destroy(): void {
    this.tray?.destroy();
  }
}

function healthTooltip(state: GepHealthState): string {
  switch (state) {
    case 'no-game': return 'Vantage — no game detected';
    case 'connected': return 'Vantage — connected, waiting for events';
    case 'live': return 'Vantage — receiving data';
    case 'stale': return 'Vantage — ⚠ match running but no data arriving';
  }
}
