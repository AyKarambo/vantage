import { h } from '../../dom';
import { card, chip } from '../../components/primitives';
import { breakReminderEditor } from '../../components/breakReminderEditor';
import { readinessSettingsEditor } from '../../components/readinessSettingsEditor';
import { isColorblind, setColorblind } from '../../theme';
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
    dataLocationCard(),
  );
}
