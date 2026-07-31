/**
 * Target library — a curated catalog of starting points, grouped under the
 * four decision-timing categories from `TARGET_CATEGORIES` (Mechanics/Macro/
 * Strategy/Training). Picking an entry loads it into the builder via
 * `BuilderHandle.prefill`, which always creates on save — it never mutates an
 * in-progress edit (see `renderer/src/views/targets/builder.ts`).
 *
 * Once the player has their own set (≥3 live authored targets — sample rows
 * don't count), the catalog collapses behind a "Show the library" chip, the
 * same threshold the old template-chip row used. Local state only: a rebuild
 * resets it, matching the old behavior.
 */
import { h, render } from '../../dom';
import {
  TARGET_CATEGORIES, TARGET_LIBRARY,
  type TargetCategory, type TargetLibraryEntry,
} from '../../../../src/core/targets';
import { badge, card } from '../../components/primitives';
import type { ViewContext } from '../view';
import type { BuilderHandle } from './builder';

export function libraryBrowserCard(ctx: ViewContext, builder: BuilderHandle): HTMLElement {
  const liveAuthored = ctx.data.isSample ? 0 : ctx.data.targets.filter((t) => !t.archivedAt).length;
  let open = liveAuthored < 3;
  const host = h('div');

  const toggleChip = (label: string, title: string): HTMLElement =>
    h('button', {
      class: `chip${open ? ' u-dim' : ''}`,
      title,
      on: { click: () => { open = !open; draw(); } },
    }, label);

  const draw = (): void => {
    render(host, card(
      { variant: 'raised', title: 'Target library', sub: 'curated starting points — pick one, make it yours' },
      open
        ? h('div', null,
            ...TARGET_CATEGORIES.map((cat) => categorySection(cat, builder)),
            // A hide affordance only makes sense once there's a set to fall back on.
            liveAuthored >= 3 ? toggleChip('Hide', 'Hide the library') : null,
          )
        : toggleChip('Show the library', 'Browse the curated target library'),
    ));
  };

  draw();
  return host;
}

function categorySection(cat: { id: TargetCategory; scope: string }, builder: BuilderHandle): HTMLElement {
  return h('div', { style: { marginBottom: '16px' } },
    h('div', { class: 'field-label' }, cat.id),
    h('div', { class: 'hint', style: { marginBottom: '8px' } }, cat.scope),
    ...TARGET_LIBRARY.filter((entry) => entry.category === cat.id).map((entry) => libraryEntry(entry, builder)),
  );
}

/** One catalog entry — a full-width button (real element, keyboard-reachable)
 *  with the entry name (+ role/Measured badges) and its blurb always visible
 *  underneath, never hidden behind a tooltip. */
function libraryEntry(entry: TargetLibraryEntry, builder: BuilderHandle): HTMLElement {
  return h('button', {
    class: 'library-entry',
    title: 'Load into the builder',
    on: { click: () => builder.prefill(entry) },
  },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '7px' } },
      h('span', { style: { fontWeight: '600', fontSize: '13px' } }, entry.name),
      entry.role !== 'All Roles' ? badge(entry.role, 'manual') : null,
      entry.mode === 'measured' ? badge('Measured', 'auto') : null,
    ),
    h('div', { class: 'hint', style: { marginTop: '3px' } }, entry.blurb),
  );
}
