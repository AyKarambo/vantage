/**
 * Improvement Target — the flexible builder plus your tracked library. The
 * builder doubles as the edit surface (row Edit re-opens it pre-filled); library
 * rows carry the lifecycle: Active toggle (graded on Review), Archive/Restore,
 * and permanent Delete behind a confirmation.
 */
import { h } from '../../dom';
import { card, emptyState } from '../../components/primitives';
import { viewHead, type ViewContext } from '../view';
import { builderCard } from './builder';
import { activeSetCard } from './activeSet';
import { libraryCard } from './library';

export function targets(ctx: ViewContext): HTMLElement {
  const builder = builderCard(ctx);
  // Focus's per-map "＋ target" quick-create lands here with a name to prefill —
  // self-rated by default, same as a fresh builder's grading mode.
  if (ctx.params.prefillName) {
    builder.prefill({ name: ctx.params.prefillName, mode: 'self', rule: 'You grade it' });
  }
  // Real mode with no authored targets shows an honest empty state (not the
  // demo sample library, and not an empty "Your targets" shell).
  const noTargets = !ctx.data.isSample && ctx.data.targets.length === 0;
  return h('div', { class: 'view', style: { maxWidth: '760px' } },
    viewHead('Improvement Target', 'Self-rated by default, measurable if you want — pick per target'),
    builder.el,
    activeSetCard(ctx),
    noTargets
      ? card({ variant: 'raised', title: 'Your targets', sub: 'does it move your winrate?' },
          emptyState('No targets yet — build your first one above and grade it after each game to see if it moves your winrate. 🎯', true))
      : libraryCard(ctx, builder.edit),
  );
}
