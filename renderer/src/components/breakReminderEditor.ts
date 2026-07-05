/**
 * The break-reminder on/off + threshold editor, shared by the Mental screen
 * (inline, where the stat lives) and the Settings screen (the canonical
 * settings home). Changes apply immediately and re-render (no toast).
 */
import { h } from '../dom';
import type { BreakReminderSettings } from '../../../src/shared/contract';
import { bridge } from '../bridge';
import { chip, select } from './primitives';
import type { ViewContext } from '../views/view';

export function breakReminderEditor(ctx: ViewContext): HTMLElement {
  const r = ctx.data.breakReminder;

  // Applies instantly and re-renders; no toast (settings toasts were distracting).
  const set = (patch: Partial<BreakReminderSettings>): void => {
    void bridge.setBreakReminder({ ...r, ...patch }).then(() => {
      ctx.refresh();
    });
  };

  const thresholdSelect = select(
    [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n} loss${n === 1 ? '' : 'es'}` })),
    String(r.afterLosses),
    (v) => set({ afterLosses: Number(v) }),
  );
  thresholdSelect.disabled = !r.enabled;

  return h('div', { class: 'stack', style: { gap: '10px', marginTop: '12px' } },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
      chip(r.enabled ? 'Break reminder: on' : 'Break reminder: off', r.enabled,
        () => set({ enabled: !r.enabled })),
      h('span', { class: 'hint' }, 'after'),
      thresholdSelect,
    ),
  );
}
