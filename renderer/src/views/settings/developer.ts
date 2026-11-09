/**
 * Settings › Developer — test switches for dev builds only. Rendered behind
 * `__DEV_TOOLS__`, which the release bundle compiles to `false`, so this module
 * never ships; main refuses the same calls in a packaged build as well.
 */
import { h } from '../../dom';
import type { DevToolsState, ProTier } from '../../../../src/shared/contract';
import { bridge } from '../../bridge';
import { card, segmented } from '../../components/primitives';
import { toast } from '../../components/toast';
import { tierLabel } from '../../proAccess';
import type { ViewContext } from '../view';

type TierChoice = ProTier | 'real';

const OPTIONS: Array<{ value: TierChoice; label: string }> = [
  { value: 'real', label: 'Real' },
  { value: 'free', label: 'Free' },
  { value: 'trial', label: 'Trial' },
  { value: 'pro', label: 'Pro' },
  { value: 'lapsed', label: 'Lapsed' },
];

export function developerCard(ctx: ViewContext): HTMLElement {
  const body = h('div', { class: 'stack', style: { gap: '10px', marginTop: '4px' } }, h('div', { class: 'hint' }, 'Loading…'));

  const paint = (state: DevToolsState): void => {
    if (!state.available) {
      body.replaceChildren(h('div', { class: 'hint' }, 'Not available in this build.'));
      return;
    }
    body.replaceChildren(
      h('div', { class: 'field-label' }, 'Vantage Pro tier'),
      segmented<TierChoice>({
        options: OPTIONS,
        value: state.proOverride ?? 'real',
        onChange: (choice) => {
          void bridge.setDevProOverride(choice === 'real' ? null : choice)
            .then((next) => { paint(next); ctx.refresh(); })
            .catch(() => toast('Couldn’t switch the tier.'));
        },
      }),
      h('div', { class: 'hint' },
        `Now: ${tierLabel(ctx.data.pro, Date.now())}${ctx.data.pro.demo ? ' (unlocked by the demo dataset)' : ''}. `,
        'In memory only — a restart goes back to Real (or OW_PRO_SIMULATE). The real entitlement cache is never touched.'),
    );
  };

  void bridge.getDevTools().then(paint, () => body.replaceChildren(h('div', { class: 'hint' }, 'Couldn’t load the developer tools.')));

  return card({ title: 'Developer', info: 'Dev builds only — compiled out of the release build.' }, body);
}
