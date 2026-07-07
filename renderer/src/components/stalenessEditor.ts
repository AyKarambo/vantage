/**
 * Active-target staleness thresholds editor (days / matches), shown in Settings →
 * Coaching. A target that has been your focus longer than either threshold gets a
 * "getting stale — rotate it" nudge on the Targets screen. Applies immediately and
 * re-renders (no toast), mirroring the break-reminder editor.
 */
import { h } from '../dom';
import type { StalenessSettings } from '../../../src/shared/contract';
import { bridge } from '../bridge';
import type { ViewContext } from '../views/view';

export function stalenessEditor(ctx: ViewContext): HTMLElement {
  const s = ctx.data.staleness;
  const set = (patch: Partial<StalenessSettings>): void => {
    void bridge.setStaleness({ ...s, ...patch }).then(() => ctx.refresh());
  };
  return h('div', { class: 'stack', style: { gap: '8px', marginTop: '12px' } },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
      h('span', { class: 'hint' }, 'Flag an active target stale after'),
      numberField(s.staleAfterDays, (n) => set({ staleAfterDays: n })),
      h('span', { class: 'hint' }, 'days or'),
      numberField(s.staleAfterMatches, (n) => set({ staleAfterMatches: n })),
      h('span', { class: 'hint' }, 'matches'),
    ),
  );
}

function numberField(value: number, onCommit: (n: number) => void): HTMLInputElement {
  const input = h('input', {
    class: 'vt-input mono', type: 'number', min: '1', step: '1', value: String(value),
    style: { width: '64px' },
  }) as HTMLInputElement;
  input.addEventListener('change', () => {
    const n = Math.max(1, Math.round(Number(input.value) || value));
    input.value = String(n);
    onCommit(n);
  });
  return input;
}
