/**
 * Settings — the app-behavior home: break reminder (canonical editor, Mental
 * keeps its inline copy), window behavior (close-to-tray, run at login),
 * appearance (colorblind palette), and diagnostics (log level + viewer).
 */
import { h, render } from '../dom';
import type { AppUiSettings } from '../../../src/shared/contract';
import { bridge } from '../bridge';
import { card, chip } from '../components/primitives';
import { breakReminderEditor } from '../components/breakReminderEditor';
import { logLevelToggle } from '../components/logLevelToggle';
import { toast } from '../components/toast';
import { isColorblind, setColorblind } from '../theme';
import { store } from '../store';
import { viewHead, type ViewContext } from './view';

export function settings(ctx: ViewContext): HTMLElement {
  return h('div', { class: 'view' },
    viewHead('Settings', 'App behavior, coaching nudges, appearance, diagnostics'),
    h('div', { class: 'grid-2' },
      card({ title: 'Coaching', sub: 'the break reminder fires a tray notification' },
        breakReminderEditor(ctx),
      ),
      appBehaviorCard(ctx),
    ),
    h('div', { class: 'grid-2' },
      card({ title: 'Appearance' },
        h('div', { style: { marginTop: '4px' } },
          chip(isColorblind() ? 'Colorblind-safe palette: on' : 'Colorblind-safe palette: off', isColorblind(), () => {
            setColorblind(!isColorblind());
            store.rerender();
          }),
          h('div', { class: 'hint', style: { marginTop: '8px' } },
            'Swaps the win/loss green–red for blue–orange across every chart and stat.'),
        ),
      ),
      diagnosticsCard(),
    ),
  );
}

/** Close-to-tray + run-at-login + demo data — persisted in the main process. */
function appBehaviorCard(ctx: ViewContext): HTMLElement {
  const body = h('div', { class: 'stack', style: { gap: '10px', marginTop: '4px' } }, h('div', { class: 'hint' }, 'Loading…'));
  void bridge.getAppSettings().then(paint);

  // demoPreference changes the dashboard payload (badge, targets, KPIs), so it
  // needs a store refetch; closeToTray/runAtLogin don't touch the dashboard.
  const refetchIfDemo = (p: Partial<AppUiSettings>): void => {
    if (p.demoPreference !== undefined) void store.refresh();
  };

  function apply(patch: Partial<AppUiSettings>, undoPatch: Partial<AppUiSettings>, label: string): void {
    void bridge.setAppSettings(patch).then((applied) => {
      paint(applied);
      refetchIfDemo(patch);
      toast(label, {
        action: {
          label: 'Undo',
          run: () => void bridge.setAppSettings(undoPatch).then((u) => { paint(u); refetchIfDemo(undoPatch); }),
        },
      });
    });
  }

  function paint(s: AppUiSettings): void {
    render(body,
      h('div', null,
        chip(s.closeToTray ? '✕ keeps Vantage in the tray' : '✕ quits Vantage', s.closeToTray,
          () => apply({ closeToTray: !s.closeToTray }, { closeToTray: s.closeToTray },
            s.closeToTray ? 'Close now quits the app' : 'Close now minimizes to the tray')),
        h('div', { class: 'hint', style: { marginTop: '6px' } },
          'When on, closing the window keeps tracking games in the background.'),
      ),
      h('div', null,
        chip(s.runAtLogin ? 'Run at login: on' : 'Run at login: off', s.runAtLogin,
          () => apply({ runAtLogin: !s.runAtLogin }, { runAtLogin: s.runAtLogin }, 'Run at login updated')),
        h('div', { class: 'hint', style: { marginTop: '6px' } },
          'Starts hidden in the tray so it never steals focus from a game.'),
      ),
      h('div', null,
        chip(s.demoPreference === 'on' ? 'Demo data: on' : 'Demo data: off', s.demoPreference === 'on',
          () => apply(
            { demoPreference: s.demoPreference === 'on' ? 'off' : 'on' },
            { demoPreference: s.demoPreference },
            'Demo data updated',
          )),
        h('div', { class: 'hint', style: { marginTop: '6px' } },
          ctx.data.hasRealHistory
            ? 'You have tracked games, so this has no visible effect — real data always wins. It applies again only if your history is empty.'
            : 'Preload a realistic sample season to explore the app. Turn it off to start from a clean slate.'),
      ),
    );
  }
  return card({ title: 'App behavior' }, body);
}

function diagnosticsCard(): HTMLElement {
  const about = h('div', { class: 'hint', style: { marginTop: '10px' } }, '');
  void bridge.getAppInfo().then((info) => {
    render(about, `Vantage ${info.version} · support: ${info.supportEmail}`);
  });
  return card({ title: 'Diagnostics', sub: 'the release debug log' },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px' } },
      logLevelToggle(),
      h('button', {
        class: 'btn btn--soft',
        on: { click: () => store.setView('logs') },
      }, 'Open log viewer'),
    ),
    h('div', { class: 'hint', style: { marginTop: '8px' } },
      'Every build writes a rotating log — GEP lifecycle, match pipeline, sync results. Tokens are never logged.'),
    about,
  );
}
