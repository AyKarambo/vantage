/**
 * The "Current session" gap-threshold editor (Settings screen). Changes apply
 * immediately and re-render (no toast, matching the other Coaching editors).
 */
import { h } from '../dom';
import type { SessionSettings } from '../../../src/shared/contract';
import { bridge } from '../bridge';
import { segmented } from './primitives';
import type { ViewContext } from '../views/view';

const GAP_PRESETS: Array<{ minutes: number; label: string }> = [
  { minutes: 30, label: '30m' },
  { minutes: 60, label: '1h' },
  { minutes: 90, label: '1.5h' },
  { minutes: 120, label: '2h' },
  { minutes: 180, label: '3h' },
  { minutes: 240, label: '4h' },
  { minutes: 360, label: '6h' },
];

export function sessionSettingsEditor(ctx: ViewContext): HTMLElement {
  const s = ctx.data.sessionSettings;

  // Applies instantly and re-renders; no toast (settings toasts were distracting).
  const set = (patch: Partial<SessionSettings>): void => {
    void bridge.setSessionSettings({ ...s, ...patch }).then(() => {
      ctx.refresh();
    });
  };

  return h('div', { class: 'stack', style: { gap: '10px', marginTop: '12px' } },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } },
      h('span', { class: 'hint' }, 'New session after a pause of'),
      segmented({
        options: GAP_PRESETS.map((p) => ({ value: String(p.minutes), label: p.label })),
        value: String(s.gapMinutes),
        onChange: (v) => set({ gapMinutes: Number(v) }),
      }),
    ),
  );
}
