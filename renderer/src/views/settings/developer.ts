/**
 * Settings › App behavior › Developer — Dev Mode, the Overwolf dev key and the
 * Vantage Pro tier switch. Only ever rendered behind `__DEV_TOOLS__`, which the
 * release bundle compiles to `false`, so this module never ships; main refuses
 * the same calls in a packaged build as well.
 */
import { h } from '../../dom';
import type { AppUiSettings, DevToolsState, ProTier } from '../../../../src/shared/contract';
import { bridge } from '../../bridge';
import { segmented, toggleRow } from '../../components/primitives';
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

// Module scope so an App behavior repaint (any toggle) neither flashes "Loading…"
// nor drops what the player is typing: the key input is created once and re-inserted.
let tierState: DevToolsState | null = null;
let devKeyInput: HTMLInputElement | null = null;

function devKeyField(): HTMLElement {
  const hint = h('div', { class: 'hint', style: { marginTop: '6px' } },
    'Stored at ~/.ow-cli/dev-key (never in the app or git). Restart Vantage to apply.');
  if (!devKeyInput) {
    const input = h('input', { class: 'vt-input', type: 'password', placeholder: 'Paste your Overwolf dev key' }) as HTMLInputElement;
    // Saves on `change` (blur/Enter), never through the paint cycle, so typing is never cut off.
    input.addEventListener('change', () => {
      void bridge.setDevKey(input.value).then((r) => {
        input.value = '';
        hint.textContent = r.hasKey
          ? 'Dev key saved at ~/.ow-cli/dev-key. Restart Vantage to apply.'
          : 'Dev key cleared. Restart Vantage to apply.';
      });
    });
    devKeyInput = input;
  }
  return h('div', null, devKeyInput, hint);
}

function tierSwitch(ctx: ViewContext): HTMLElement {
  const body = h('div', { class: 'stack', style: { gap: '10px' } });

  const paint = (state: DevToolsState): void => {
    tierState = state;
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

  if (tierState) paint(tierState);
  else body.append(h('div', { class: 'hint' }, 'Loading…'));
  void bridge.getDevTools().then(paint, () => body.replaceChildren(h('div', { class: 'hint' }, 'Couldn’t load the developer tools.')));
  return body;
}

export function developerSection(ctx: ViewContext, s: AppUiSettings, apply: (patch: Partial<AppUiSettings>) => void): HTMLElement {
  return h('div', { class: 'stack', style: { gap: '10px', marginTop: '4px' } },
    h('div', { style: { fontSize: '11.5px', fontWeight: '600', color: 'var(--text-1)' } }, 'Developer'),
    h('div', { class: 'hint' }, 'Dev builds only — compiled out of the release build.'),
    toggleRow({
      label: 'Dev Mode',
      on: s.devMode,
      onChange: () => apply({ devMode: !s.devMode }),
      info: 'When on, the launcher loads real Overwatch (GEP) data using your dev key.',
      hint: 'Applies on the next launch.',
    }),
    devKeyField(),
    tierSwitch(ctx),
  );
}
