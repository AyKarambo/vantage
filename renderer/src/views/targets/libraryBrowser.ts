/**
 * Target library — a curated catalog of starting points, grouped under the
 * four decision-timing categories from `TARGET_CATEGORIES` (Mechanics/Macro/
 * Strategy/Training). Picking an entry loads it into the builder via
 * `BuilderHandle.prefill`, which always creates on save — it never mutates an
 * in-progress edit (see `renderer/src/views/targets/builder.ts`).
 */
import { h } from '../../dom';
import {
  TARGET_CATEGORIES, TARGET_LIBRARY,
  type TargetCategory, type TargetLibraryEntry,
} from '../../../../src/core/targets';
import { badge, card } from '../../components/primitives';
import type { BuilderHandle } from './builder';

export function libraryBrowserCard(builder: BuilderHandle): HTMLElement {
  return card(
    { variant: 'raised', title: 'Target library', sub: 'curated starting points — pick one, make it yours' },
    ...TARGET_CATEGORIES.map((cat) => categorySection(cat, builder)),
  );
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
