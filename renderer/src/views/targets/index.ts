/**
 * Improvement Target — the flexible builder plus your tracked list. Rows stay
 * plain (name, status line, hit-rate, Active toggle) and click through to the
 * target detail page, which carries the analytics and the Edit/Archive/Delete
 * lifecycle; the detail's Edit returns here via `editTargetId` to re-open the
 * builder pre-filled. The Target library card at the bottom lets a player
 * browse curated starting points and prefill the builder from one.
 */
import { h } from '../../dom';
import type { ViewParams } from '../../store';
import { store } from '../../store';
import { button, card, emptyState } from '../../components/primitives';
import { viewHead, type ViewContext } from '../view';
import { builderCard } from './builder';
import { activeSetCard } from './activeSet';
import { libraryCard } from './library';
import { libraryBrowserCard } from './libraryBrowser';

/** Params objects already applied to the builder. `setView` builds a fresh
 *  params object per navigation while data refreshes keep the same reference,
 *  so object identity is exactly "one edit per navigation". */
const consumedEditParams = new WeakSet<ViewParams>();

/**
 * Set once the player explicitly opens the collapsed builder via
 * "＋ New target" (R5) — stays true for the rest of the session (mirrors
 * `gradedThisSession` elsewhere) so a `store.rerender()` triggered by
 * something else doesn't collapse an in-progress, unsaved target out from
 * under the player.
 */
let builderManuallyOpened = false;

export function targets(ctx: ViewContext): HTMLElement {
  // Real mode with no authored targets shows an honest empty state (not the
  // demo sample library, and not an empty "Your targets" shell) — and is the
  // only case that still opens the builder first: a returning player with a
  // live set gets their own targets on screen immediately instead of a
  // pre-filled form (R5), with everything below computed the same way.
  const noTargets = !ctx.data.isSample && ctx.data.targets.length === 0;
  const willPrefill = ctx.params.prefillName != null;
  const willEdit = ctx.params.editTargetId != null && !consumedEditParams.has(ctx.params);
  const startOpen = noTargets || willPrefill || willEdit || builderManuallyOpened;

  const builder = builderCard(ctx, { startOpen });
  // Focus's per-map/hero/role "＋ target" quick-create lands here with a name
  // to prefill — self-rated by default, same as a fresh builder's grading
  // mode — and, for a hero/role entry (H1), the matching scope pre-selected.
  if (willPrefill) {
    builder.prefill({
      name: ctx.params.prefillName!, mode: 'self', rule: 'You grade it',
      roleScope: ctx.params.prefillRole, heroScope: ctx.params.prefillHeroes,
    });
  }
  // A detail page's Edit lands here with the target to re-open in the builder.
  // One navigation = one edit: a background refresh re-renders this view with
  // the SAME params object, and replaying builder.edit() then would force the
  // builder back into edit mode — the silent-overwrite trap (review finding).
  if (willEdit) {
    consumedEditParams.add(ctx.params);
    const editing = ctx.data.targets.find((t) => t.id === ctx.params.editTargetId);
    if (editing) builder.edit(editing);
  }

  // Collapsed into a single action rather than always on screen (R5) — once
  // there's a real set to show, "how are my targets doing" is the page's
  // actual daily question, not "here's a blank form".
  const newTargetAction = startOpen
    ? undefined
    : button('＋ New target', {
        variant: 'soft',
        onClick: () => { builderManuallyOpened = true; store.rerender(); },
      });

  const emptyStateCard = card({ variant: 'raised', title: 'Your targets', sub: 'does it move your winrate?' },
    emptyState('No targets yet — build your first one above and grade it after each game to see if it moves your winrate. 🎯', true));

  return h('div', { class: 'view view--narrow' },
    // "Targets" (R8) — the nav item, the back-stack label and the list card
    // itself all already said this; the head alone still said "Improvement
    // Target" (singular), which nothing else on the screen agreed with.
    viewHead('Targets', 'Self-rated by default, measurable if you want — pick per target', newTargetAction),
    noTargets
      ? [builder.el, activeSetCard(ctx), emptyStateCard]
      : [activeSetCard(ctx), libraryCard(ctx), builder.el],
    libraryBrowserCard(ctx, builder),
  );
}
