/**
 * Improvement Target — the flexible builder plus your tracked library. The
 * builder doubles as the edit surface (row Edit re-opens it pre-filled); library
 * rows carry the lifecycle: Active toggle (graded on Review), Archive/Restore,
 * and permanent Delete behind a confirmation.
 */
import { h } from '../../dom';
import { viewHead, type ViewContext } from '../view';
import { builderCard } from './builder';
import { libraryCard } from './library';

export function targets(ctx: ViewContext): HTMLElement {
  const builder = builderCard(ctx);
  return h('div', { class: 'view', style: { maxWidth: '760px' } },
    viewHead('Improvement Target', 'Self-rated by default, measurable if you want — pick per target'),
    builder.el,
    libraryCard(ctx, builder.edit),
  );
}
