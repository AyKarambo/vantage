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
}

/**
 * The single Windows tray icon + context menu and toast notifications.
 * There is no window and no in-game overlay — this is the entire visible surface.
 */
export class TrayController {
  private tray!: Tray;
  private state: TrayState = { status: 'Starting…', autoLaunch: false, tokenSet: false };

  constructor(
    private readonly iconPath: string,
    private readonly handlers: TrayHandlers,
  ) {}

  init(initial: Partial<TrayState>): void {
    this.state = { ...this.state, ...initial };
    this.tray = new Tray(this.icon());
    this.tray.setToolTip('Vantage');
    this.tray.on('double-click', () => this.handlers.onOpenDashboard());
    this.rebuild();
  }

  setState(patch: Partial<TrayState>): void {
    this.state = { ...this.state, ...patch };
    this.rebuild();
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
    const menu = Menu.buildFromTemplate([
      { label: 'Open Dashboard', click: () => this.handlers.onOpenDashboard() },
      { type: 'separator' },
      { label: this.state.status, enabled: false },
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
