import { app } from 'electron';

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
