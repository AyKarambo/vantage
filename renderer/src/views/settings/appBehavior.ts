import { h, render } from '../../dom';
import type { AppInfo, AppUiSettings } from '../../../../src/shared/contract';
import { bridge } from '../../bridge';
import { card, chip } from '../../components/primitives';
import { store } from '../../store';
import type { ViewContext } from '../view';

/** localStorage flag: once the Dev Mode easter egg is unlocked, it stays unlocked. */
const DEV_UNLOCK_KEY = 'vantage.devUnlocked';
const TAPS_TO_UNLOCK = 5;
// Module scope so the count survives a Settings re-render (which rebuilds this
// whole card and would otherwise reset a per-instance counter mid-sequence).
let unlockTaps = 0;

function readUnlocked(): boolean {
  try {
    return localStorage.getItem(DEV_UNLOCK_KEY) === '1';
  } catch {
    return false;
  }
}

/** Close-to-tray + run-at-login + demo data — plus a hidden Dev Mode section. */
export function appBehaviorCard(ctx: ViewContext): HTMLElement {
  const body = h('div', { class: 'stack', style: { gap: '10px', marginTop: '4px' } }, h('div', { class: 'hint' }, 'Loading…'));
  // AppInfo is a build-constant (packaged / devMode); fetched alongside settings.
  let info: AppInfo | null = null;
  let last: AppUiSettings | null = null;
  // Dev Mode is a hidden feature: revealed only once the easter egg is unlocked,
  // or when the app is already running in Dev Mode (so it can be turned off).
  let unlocked = readUnlocked();

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

  function devModeSection(s: AppUiSettings): HTMLElement {
    const packaged = info?.packaged ?? false;
    // Reveal on any attempt this run, not just a confirmed one — a *failed*
    // dev-mode auth (the exact case this section's toggle is most useful for)
    // must not stay hidden behind the easter egg.
    const show = unlocked || (info?.devModeAttempted ?? false);
    return h('div', { class: show ? 'stack' : 'hidden', style: { gap: '10px', marginTop: '4px' } },
      h('div', { style: { fontSize: '11.5px', fontWeight: '600', color: 'var(--text-1)' } }, 'Dev Mode'),
      h('div', null,
        // Packaged builds can never run Dev Mode → show it as unavailable and inert,
        // not a fake "on" (AC5: never a silent no-op).
        chip(
          packaged ? 'Dev Mode: unavailable' : (s.devMode ? 'Dev Mode: on' : 'Dev Mode: off'),
          packaged ? false : s.devMode,
          packaged ? undefined : () => apply({ devMode: !s.devMode }),
        ),
        h('div', { class: 'hint', style: { marginTop: '6px' } },
          packaged
            ? 'Unavailable in the installed build — Dev Mode only runs in the unpackaged dev build.'
            : 'When on, the launcher loads real Overwatch (GEP) data using your dev key. Applies on the next launch.'),
      ),
      // The dev-key field is meaningless in a packaged build; hide it there.
      h('div', { class: packaged ? 'hidden' : '' }, devKeyInput, devKeyHint),
    );
  }

  function paint(s: AppUiSettings): void {
    last = s;
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
      h('div', null,
        chip(s.gepNotifications ? 'GEP alerts: on' : 'GEP alerts: off', s.gepNotifications,
          () => apply({ gepNotifications: !s.gepNotifications })),
        h('div', { class: 'hint', style: { marginTop: '6px' } },
          'Notify me when Overwatch game events go down (an Overwolf outage) and when they recover. The in-app banner shows either way.'),
      ),
      devModeSection(s),
    );
  }

  const cardEl = card({ title: 'App behavior' }, body);
  // Easter egg: clicking the card header TAPS_TO_UNLOCK times reveals Dev Mode.
  // The whole header is the hit target (not just the title text) so it's easy to
  // find, and `unlockTaps` lives at module scope so a Settings re-render — which
  // rebuilds this card — doesn't reset progress mid-sequence. Not advertised.
  const head = cardEl.querySelector('.card-head') as HTMLElement | null;
  if (head) {
    head.addEventListener('click', () => {
      if (unlocked) return;
      unlockTaps += 1;
      if (unlockTaps < TAPS_TO_UNLOCK) return;
      unlocked = true;
      unlockTaps = 0;
      try {
        localStorage.setItem(DEV_UNLOCK_KEY, '1');
      } catch {
        /* storage unavailable — session-only unlock still works */
      }
      if (last) paint(last);
    });
  }
  return cardEl;
}
