/**
 * The measured-target "partial credit" margin editor (Settings → Coaching). A
 * measured stat within this margin of its threshold (on the failing side) grades
 * Partial rather than Missed. Applies immediately and re-renders — no toast,
 * matching the sibling Coaching editors.
 */
import { h } from '../dom';
import type { GradingSettings } from '../../../src/shared/contract';
import { bridge } from '../bridge';
import { segmented } from './primitives';
import type { ViewContext } from '../views/view';

const MARGIN_PRESETS: Array<{ margin: number; label: string }> = [
  { margin: 0, label: 'Off' },
  { margin: 0.1, label: '10%' },
  { margin: 0.15, label: '15%' },
  { margin: 0.2, label: '20%' },
  { margin: 0.25, label: '25%' },
  { margin: 0.3, label: '30%' },
];

export function gradingSettingsEditor(ctx: ViewContext): HTMLElement {
  const s = ctx.data.gradingSettings;

  // Applies instantly and re-renders; no toast (settings toasts were distracting).
  const set = (patch: Partial<GradingSettings>): void => {
    void bridge.setGrading({ ...s, ...patch }).then(() => {
      ctx.refresh();
    });
  };

  return h('div', { class: 'stack', style: { gap: '10px', marginTop: '12px' } },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } },
      h('span', { class: 'hint' }, 'Measured target scores Partial within'),
      segmented({
        options: MARGIN_PRESETS.map((p) => ({ value: String(p.margin), label: p.label })),
        value: String(s.partialMargin),
        onChange: (v) => set({ partialMargin: Number(v) }),
      }),
      h('span', { class: 'hint' }, 'of its target'),
    ),
  );
}
