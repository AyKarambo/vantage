import { h, render } from '../../dom';
import type { AppInfo, AppUiSettings } from '../../../../src/shared/contract';
import { bridge } from '../../bridge';
import { card, chip } from '../../components/primitives';
import { store } from '../../store';
import type { ViewContext } from '../view';

/** Close-to-tray + run-at-login + demo data + Dev Mode — persisted in the main process. */
export function appBehaviorCard(ctx: ViewContext): HTMLElement {
  const body = h('div', { class: 'stack', style: { gap: '10px', marginTop: '4px' } }, h('div', { class: 'hint' }, 'Loading…'));
  // AppInfo is a build-constant (packaged / devMode); fetched alongside settings.
  let info: AppInfo | null = null;

  // The dev-key input is created ONCE so a repaint (from an unrelated toggle)
  // re-inserts the same node, preserving its value. It saves on `change`
  // (blur/Enter) — never through the paint cycle — so typing is never cut off.
  const devKeyInput = h('input', {
    class: 'vt-input',
    type: 'password',
    placeholder: 'Paste your Overwolf dev key',
  }) as HTMLInputElement;
  const devKeyHint = h('div', { class: 'hint', style: { marginTop: '6px' } },
    'Stored at ~/.ow-cli/dev-key (never in the app or git). Restart Vantage to apply.');
  devKeyInput.addEventListener('change', () => {
    void bridge.setDevKey(devKeyInput.value).then((r) => {
      devKeyInput.value = '';
      devKeyHint.textContent = r.hasKey
        ? 'Dev key saved at ~/.ow-cli/dev-key. Restart Vantage to apply.'
        : 'Dev key cleared. Restart Vantage to apply.';
    });
  });

  const load = (): void => {
    void Promise.all([bridge.getAppSettings(), bridge.getAppInfo()]).then(([s, i]) => {
      info = i;
      paint(s);
    });
  };
  load();

  // demoPreference changes the dashboard payload (badge, targets, KPIs), so it
  // needs a store refetch; the other toggles don't touch the dashboard.
  const refetchIfDemo = (p: Partial<AppUiSettings>): void => {
    if (p.demoPreference !== undefined) void store.refresh();
  };

  // Settings apply instantly; the chip flips to show the new state, so no toast.
  function apply(patch: Partial<AppUiSettings>): void {
    void bridge.setAppSettings(patch).then((applied) => {
      paint(applied);
      refetchIfDemo(patch);
    });
  }

  function paint(s: AppUiSettings): void {
    const packaged = info?.packaged ?? false;
    render(body,
      h('div', null,
        chip(s.closeToTray ? '✕ keeps Vantage in the tray' : '✕ quits Vantage', s.closeToTray,
          () => apply({ closeToTray: !s.closeToTray })),
        h('div', { class: 'hint', style: { marginTop: '6px' } },
          'When on, closing the window keeps tracking games in the background.'),
      ),
      h('div', null,
        chip(s.runAtLogin ? 'Run at login: on' : 'Run at login: off', s.runAtLogin,
          () => apply({ runAtLogin: !s.runAtLogin })),
        h('div', { class: 'hint', style: { marginTop: '6px' } },
          'Starts hidden in the tray so it never steals focus from a game.'),
      ),
      h('div', null,
        chip(s.demoPreference === 'on' ? 'Demo data: on' : 'Demo data: off', s.demoPreference === 'on',
          () => apply({ demoPreference: s.demoPreference === 'on' ? 'off' : 'on' })),
        h('div', { class: 'hint', style: { marginTop: '6px' } },
          ctx.data.hasRealHistory
            ? 'You have tracked games, so this has no visible effect — real data always wins. It applies again only if your history is empty.'
            : 'Preload a realistic sample season to explore the app. Turn it off to start from a clean slate.'),
      ),
      // Dev Mode — real GEP data before store approval (unpackaged dev runs only).
      h('div', { style: { marginTop: '10px', fontSize: '11.5px', fontWeight: '600', color: 'var(--text-1)' } }, 'Dev Mode'),
      h('div', null,
        // No click handler when packaged → a disabled-looking, inert chip (AC5).
        chip(s.devMode ? 'Dev Mode: on' : 'Dev Mode: off', s.devMode,
          packaged ? undefined : () => apply({ devMode: !s.devMode })),
        h('div', { class: 'hint', style: { marginTop: '6px' } },
          packaged
            ? 'Unavailable in the installed build — Dev Mode only runs in the unpackaged dev build.'
            : 'When on, the launcher loads real Overwatch (GEP) data using your dev key. Applies on the next launch.'),
      ),
      // The dev-key field is meaningless in a packaged build; hide it there.
      h('div', { class: packaged ? 'hidden' : '' }, devKeyInput, devKeyHint),
    );
  }
  return card({ title: 'App behavior' }, body);
}
