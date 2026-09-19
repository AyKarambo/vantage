/**
 * The readiness on/off + launch-toast editor, shared by the Readiness screen and
 * the Settings screen (mirrors breakReminderEditor). Changes apply immediately
 * and re-render (no toast).
 */
import { h } from '../dom';
import type { ReadinessSettings } from '../../../src/shared/contract';
import { bridge } from '../bridge';
import { toggleRow } from './primitives';
import type { ViewContext } from '../views/view';

export function readinessSettingsEditor(ctx: ViewContext): HTMLElement {
  const r = ctx.data.readinessSettings;

  const set = (patch: Partial<ReadinessSettings>): void => {
    void bridge.setReadiness({ ...r, ...patch }).then(() => {
      ctx.refresh();
    });
  };

  return h('div', { class: 'stack', style: { gap: '10px', marginTop: '12px' } },
    toggleRow({ label: 'Readiness coach', on: r.enabled, onChange: () => set({ enabled: !r.enabled }) }),
    // K3: disabled rather than removed when readiness itself is off — a
    // row that vanishes and reappears changes the card's shape under you
    // every time you flip the parent toggle, for no reason a disabled
    // (still-visible) control doesn't already communicate.
    toggleRow({
      label: 'Launch reminder',
      on: r.launchToast,
      disabled: !r.enabled,
      onChange: () => set({ launchToast: !r.launchToast }),
    }),
    h('div', { class: 'hint' },
      r.enabled
        ? 'Optional launch reminder: a one-time tray nudge at startup when you’re grinding into the hole (off by default).'
        : 'Turn on to track training load and get rest recommendations from your history and mental tracking.'),
  );
}
