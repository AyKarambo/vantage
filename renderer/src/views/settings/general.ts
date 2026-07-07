import { h } from '../../dom';
import { card, segmented } from '../../components/primitives';
import { breakReminderEditor } from '../../components/breakReminderEditor';
import { readinessSettingsEditor } from '../../components/readinessSettingsEditor';
import { getWinrateScheme, setWinrateScheme } from '../../theme';
import { WINRATE_SCHEME_OPTIONS, type WinrateScheme } from '../../winrateScheme';
import { store } from '../../store';
import type { ViewContext } from '../view';
import { accountsCard } from './accounts';
import { appBehaviorCard } from './appBehavior';
import { diagnosticsCard } from './diagnostics';
import { dataLocationCard } from './dataLocation';

/** Accounts, Coaching, App Behavior, Appearance, Diagnostics, Data Storage. */
export function generalTab(ctx: ViewContext): HTMLElement {
  return h('div', { class: 'stack', style: { gap: '18px' } },
    accountsCard(),
    h('div', { class: 'grid-2' },
      card({ title: 'Coaching', sub: 'break reminder + readiness nudges' },
        breakReminderEditor(ctx),
        readinessSettingsEditor(ctx),
      ),
      appBehaviorCard(ctx),
    ),
    h('div', { class: 'grid-2' },
      card({ title: 'Appearance' },
        h('div', { style: { marginTop: '4px' } },
          h('div', { class: 'field-label' }, 'Winrate colours'),
          segmented<WinrateScheme>({
            options: [...WINRATE_SCHEME_OPTIONS],
            value: getWinrateScheme(),
            onChange: (scheme) => {
              setWinrateScheme(scheme);
              store.rerender();
            },
          }),
          h('div', { class: 'hint', style: { marginTop: '8px' } },
            'Colours the win / loss / draw stats across every chart and screen. ' +
            'Colorblind uses a blue–orange palette instead of teal–rose.'),
        ),
      ),
      diagnosticsCard(),
    ),
    dataLocationCard(),
  );
}
