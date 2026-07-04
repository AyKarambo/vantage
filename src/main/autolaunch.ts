import { app } from 'electron';

/**
 * Launch-on-login registration via Electron's login-item settings.
 * Main-process Electron edge; auto-launched instances start hidden (tray-only)
 * so the app never steals focus from a running game.
 */

/** Whether the app is registered to launch on user login. */
export function isAutoLaunchEnabled(): boolean {
  return app.getLoginItemSettings().openAtLogin;
}

/** Enable/disable launch-on-login. Started hidden (tray-only) when auto-launched. */
export function setAutoLaunch(enabled: boolean): void {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    args: ['--hidden'],
  });
}
