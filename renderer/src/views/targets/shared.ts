/**
 * Helpers shared between the Targets list and the target detail page: the
 * win-when-hit / when-missed split bars and the permanent-delete confirmation.
 * They moved out of library.ts when the analytics left the list rows for the
 * detail view — both surfaces must keep identical semantics.
 */
import { h } from '../../dom';
import type { TargetSummary } from '../../../../src/shared/contract';
import { pct } from '../../format';
import { button } from '../../components/primitives';
import { openModal } from '../../components/overlay';
import { bridge } from '../../bridge';
import type { ViewContext } from '../view';

/** One labelled winrate track (win when hit / when missed). */
export function winSplit(label: string, frac: number, barColor: string, textColor: string): HTMLElement {
  const fill = h('div', { class: 'track-fill', style: { width: `${Math.round(frac * 100)}%`, background: barColor } });
  return h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '6px' } },
    h('span', { style: { fontSize: '10px', color: 'var(--muted-2)', width: '82px', flex: '0 0 auto' } }, label),
    h('div', { class: 'track track--slim' }, fill),
    h('span', { class: 'mono', style: { fontSize: '10.5px', color: textColor, width: '30px', textAlign: 'right', flex: '0 0 auto' } }, pct(frac)),
  );
}

/** Permanent delete stays behind a modal; `after` runs post-delete before the
 *  refresh (the detail page uses it to navigate back to the list). */
export function confirmDelete(t: TargetSummary, ctx: ViewContext, after?: () => void): void {
  openModal((close) =>
    h('div', { style: { padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' } },
      h('div', { style: { fontFamily: 'var(--font-head)', fontSize: '16px', fontWeight: '600' } }, `Delete "${t.name}"?`),
      h('div', { class: 'hint', style: { lineHeight: '1.5' } },
        'This permanently removes the target from your library and its stats stop counting. Grades already saved on match reviews stay stored but inert. Archive instead if you might want it back.'),
      h('div', { style: { display: 'flex', gap: '10px' } },
        button('Delete permanently', {
          variant: 'primary',
          onClick: () => void bridge.deleteTarget(t.id).then(() => { close(); after?.(); ctx.refresh(); }),
        }),
        button('Keep it', { variant: 'ghost', onClick: close }),
      ),
    ),
  );
}
