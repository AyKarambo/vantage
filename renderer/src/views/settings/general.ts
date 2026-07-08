import { h } from '../../dom';
import { card, segmented } from '../../components/primitives';
import { breakReminderEditor } from '../../components/breakReminderEditor';
import { readinessSettingsEditor } from '../../components/readinessSettingsEditor';
import { stalenessEditor } from '../../components/stalenessEditor';
import { getWinrateScheme, setWinrateScheme } from '../../theme';
import { WINRATE_SCHEME_OPTIONS, type WinrateScheme } from '../../winrateScheme';
import { prefs, DEFAULT_SUGGESTED_HEROES, clampSuggestedHeroCount } from '../../prefs';
import { store } from '../../store';
import type { ViewContext } from '../view';
import { accountsCard } from './accounts';
import { appBehaviorCard } from './appBehavior';
import { diagnosticsCard } from './diagnostics';
import { dataLocationCard } from './dataLocation';
import { importCard } from './importCard';

/**
 * Quick Log preferences: how many "most played" heroes the Log Match hero
 * picker shortlists before falling back to search. Client-side only (no
 * bridge round-trip) — the card re-reads the live value each time it opens.
 */
function quickLogCard(): HTMLElement {
  const value = prefs.get('suggestedHeroCount') ?? DEFAULT_SUGGESTED_HEROES;
  const input = h('input', {
    class: 'vt-input mono', type: 'number', min: '3', max: '15', step: '1',
    value: String(value),
    style: { width: '70px' },
  }) as HTMLInputElement;
  input.addEventListener('change', () => {
    const n = clampSuggestedHeroCount(Number(input.value) || DEFAULT_SUGGESTED_HEROES);
    input.value = String(n);
    prefs.set('suggestedHeroCount', n);
  });
  return card(
    { title: 'Quick Log', sub: 'preferences for the Log Match card' },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px' } },
      h('span', { class: 'field-label', style: { margin: '0' } }, 'Suggested heroes shown'),
      input,
    ),
    h('div', { class: 'hint', style: { marginTop: '8px' } },
      'The hero picker defaults to your most-played heroes for the selected role and account; search reaches everything else.'),
  );
}

/** Accounts, Quick Log, Coaching, App Behavior, Appearance, Diagnostics, Data Storage. */
export function generalTab(ctx: ViewContext): HTMLElement {
  return h('div', { class: 'stack', style: { gap: '18px' } },
    accountsCard(),
    quickLogCard(),
    h('div', { class: 'grid-2' },
      card({ title: 'Coaching', sub: 'break reminder + readiness + target rotation' },
        breakReminderEditor(ctx),
        readinessSettingsEditor(ctx),
        stalenessEditor(ctx),
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
    importCard(),
  );
}
