/**
 * Improvement Target — the flexible builder plus your tracked list. Rows stay
 * plain (name, status line, hit-rate, Active toggle) and click through to the
 * target detail page, which carries the analytics and the Edit/Archive/Delete
 * lifecycle; the detail's Edit returns here via `editTargetId` to re-open the
 * builder pre-filled. The Target library card at the bottom lets a player
 * browse curated starting points and prefill the builder from one.
 */
import { h } from '../../dom';
import { card, emptyState } from '../../components/primitives';
import { viewHead, type ViewContext } from '../view';
import { builderCard } from './builder';
import { activeSetCard } from './activeSet';
import { libraryCard } from './library';
import { libraryBrowserCard } from './libraryBrowser';

export function targets(ctx: ViewContext): HTMLElement {
  const builder = builderCard(ctx);
  // Focus's per-map "＋ target" quick-create lands here with a name to prefill —
  // self-rated by default, same as a fresh builder's grading mode.
  if (ctx.params.prefillName) {
    builder.prefill({ name: ctx.params.prefillName, mode: 'self', rule: 'You grade it' });
  }
  // A detail page's Edit lands here with the target to re-open in the builder.
  if (ctx.params.editTargetId) {
    const editing = ctx.data.targets.find((t) => t.id === ctx.params.editTargetId);
    if (editing) builder.edit(editing);
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
      : libraryCard(ctx),
    libraryBrowserCard(builder),
  );
}
