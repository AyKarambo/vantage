/**
 * Quick-create a practice target scoped to a map/hero/role that isn't tracked
 * yet — pre-fills the builder with the matching scope (H1, R9) so it opens
 * already scoped, not just named. Shared by Focus's own rows (H1) and the
 * Overview scatter's "Top priority" callouts (O4), so both stay on the same
 * `prefillName`/confirm-popover behaviour instead of drifting apart.
 */
import { h } from '../dom';
import type { Role } from '../../../src/shared/contract';
import { roleLabel } from '../format';
import { button } from './primitives';
import { openPopover } from './popover';
import type { ViewContext } from '../views/view';

export type PracticeTargetDimension = 'role' | 'hero' | 'map';

export function practiceTargetButton(ctx: ViewContext, dimension: PracticeTargetDimension, key: string): HTMLElement {
  const label = dimension === 'role' ? roleLabel(key as Role) : key;
  const name = `Practice ${label}: warm up unranked + review one replay`;
  const params = {
    prefillName: name,
    ...(dimension === 'role' ? { prefillRole: key as Role } : {}),
    ...(dimension === 'hero' ? { prefillHeroes: [key] } : {}),
    ...(dimension === 'map' ? { prefillMap: [key] } : {}),
  };
  const btn = h('button', {
    class: 'btn btn--ghost',
    style: { padding: '3px 8px', fontSize: '10.5px' },
    title: `Create a practice target for ${label}`,
  }, 'Track as target');
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    openTrackPopover(btn, name, label, () => ctx.navigate('targets', params));
  });
  return btn;
}

/**
 * Explains what "Track as target" actually creates before committing (R9) —
 * a returning player clicking a bare "＋ target" button had no idea it
 * silently created a self-rated target and navigated away; this spells out
 * the prefilled name and what tracking means (graded every matching game,
 * progress shown back on this row) with a single confirm action.
 */
function openTrackPopover(anchor: HTMLElement, name: string, label: string, onConfirm: () => void): void {
  openPopover(anchor, (close) =>
    h('div', { class: 'stack', style: { gap: '10px', minWidth: '240px', maxWidth: '280px' } },
      h('div', { class: 'field-label' }, 'Track as target'),
      h('div', { class: 'hint', style: { lineHeight: '1.5' } },
        `Creates a self-rated target scoped to ${label}, named “${name}”. You grade it Hit/Partial/Missed after every matching game, and this row will show your progress since you started tracking it.`),
      button('Track as target', {
        variant: 'primary', class: 'btn--block',
        onClick: () => { close(); onConfirm(); },
      }),
    ),
  );
}
