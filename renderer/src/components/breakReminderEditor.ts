/**
 * The break-reminder on/off + threshold editor, shared by the Mental screen
 * (inline, where the stat lives) and the Settings screen (the canonical
 * settings home). Changes apply immediately with an Undo toast.
 */
import { h } from '../dom';
import type { BreakReminderSettings } from '../../../src/shared/contract';
import { bridge } from '../bridge';
import { chip, select } from './primitives';
import { toast } from './toast';
import type { ViewContext } from '../views/view';

export function breakReminderEditor(ctx: ViewContext): HTMLElement {
  const r = ctx.data.breakReminder;

  const set = (patch: Partial<BreakReminderSettings>): void => {
    const previous: BreakReminderSettings = { ...r };
    void bridge.setBreakReminder({ ...r, ...patch }).then(() => {
      ctx.refresh();
      toast('Break reminder updated', {
        action: {
          label: 'Undo',
          run: () => void bridge.setBreakReminder(previous).then(() => ctx.refresh()),
        },
      });
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
