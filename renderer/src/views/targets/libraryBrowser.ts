/**
 * Target library — a curated catalog of starting points, grouped under the
 * four decision-timing categories from `TARGET_CATEGORIES` (Mechanics/Macro/
 * Strategy/Training). Picking an entry's main area loads it into the builder
 * via `BuilderHandle.prefill` ("Customize") — always creates on save, never
 * mutates an in-progress edit (see `renderer/src/views/targets/builder.ts`) —
 * or its "Add" button saves it exactly as written, no detour through the
 * builder (R5).
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
import { badge, button, card, chip } from '../../components/primitives';
import { toast } from '../../components/toast';
import { bridge } from '../../bridge';
import { store } from '../../store';
import type { ViewContext } from '../view';
import type { BuilderHandle } from './builder';

/** A single-select facet (R5): a role narrows to that role's entries plus the
 *  universal 'All Roles' ones; 'measured' cuts across role entirely. */
type LibraryFilter = 'all' | 'Tank' | 'DPS' | 'Support' | 'measured';

const FILTER_OPTIONS: Array<{ value: LibraryFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'Tank', label: 'Tank' },
  { value: 'DPS', label: 'DPS' },
  { value: 'Support', label: 'Support' },
  { value: 'measured', label: 'Measured only' },
];

export function libraryBrowserCard(ctx: ViewContext, builder: BuilderHandle): HTMLElement {
  const liveAuthored = ctx.data.isSample ? 0 : ctx.data.targets.filter((t) => !t.archivedAt).length;
  let open = liveAuthored < 3;
  let filter: LibraryFilter = 'all';
  const host = h('div');

  const matchesFilter = (entry: TargetLibraryEntry): boolean => {
    if (filter === 'all') return true;
    if (filter === 'measured') return entry.mode === 'measured';
    return entry.role === filter || entry.role === 'All Roles';
  };

  // "✓ in your targets" (R5) — matched by name against the player's own live
  // (non-archived) set; sample/demo data has nothing of the player's own to
  // mark against.
  const ownedNames = new Set(
    ctx.data.isSample ? [] : ctx.data.targets.filter((t) => !t.archivedAt).map((t) => t.name),
  );

  // Saves the entry exactly as written — no detour through the builder
  // (R5). The toast's Edit still routes through the normal editTargetId
  // param (same as the detail page's own Edit), so it needs the fresh id —
  // saveTarget itself doesn't return one, hence the refetch-then-find.
  const addEntry = (entry: TargetLibraryEntry): void => {
    void bridge.saveTarget({ name: entry.name, mode: entry.mode, rule: entry.rule }).then(async () => {
      await store.refresh();
      const fresh = store.get().data?.targets.find((t) => !t.archivedAt && t.name === entry.name);
      toast(`Added "${entry.name}"`, {
        action: fresh ? { label: 'Edit', run: () => ctx.navigate('targets', { editTargetId: fresh.id }) } : undefined,
      });
    });
  };

  const toggleChip = (label: string, title: string): HTMLElement =>
    h('button', {
      class: `chip${open ? ' u-dim' : ''}`,
      title,
      on: { click: () => { open = !open; draw(); } },
    }, label);

  const filterRow = (): HTMLElement =>
    h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '14px' } },
      ...FILTER_OPTIONS.map((opt) => chip(opt.label, filter === opt.value, () => { filter = opt.value; draw(); })));

  const draw = (): void => {
    const sections = TARGET_CATEGORIES
      .map((cat) => categorySection(cat, builder, matchesFilter, ownedNames, addEntry))
      .filter((n): n is HTMLElement => n != null);
    render(host, card(
      { variant: 'raised', title: 'Target library', sub: 'curated starting points — pick one, make it yours' },
      open
        ? h('div', null,
            filterRow(),
            sections.length ? sections : h('div', { class: 'hint' }, 'No entries match this filter.'),
            // A hide affordance only makes sense once there's a set to fall back on.
            liveAuthored >= 3 ? toggleChip('Hide', 'Hide the library') : null,
          )
        : toggleChip('Show the library', 'Browse the curated target library'),
    ));
  };

  draw();
  return host;
}

function categorySection(
  cat: { id: TargetCategory; scope: string },
  builder: BuilderHandle,
  matchesFilter: (entry: TargetLibraryEntry) => boolean,
  ownedNames: Set<string>,
  addEntry: (entry: TargetLibraryEntry) => void,
): HTMLElement | null {
  const entries = TARGET_LIBRARY.filter((entry) => entry.category === cat.id && matchesFilter(entry));
  if (!entries.length) return null;
  return h('div', { style: { marginBottom: '16px' } },
    h('div', { class: 'field-label' }, cat.id),
    h('div', { class: 'hint', style: { marginBottom: '8px' } }, cat.scope),
    ...entries.map((entry) => libraryEntry(entry, builder, ownedNames.has(entry.name), addEntry)),
  );
}

/**
 * One catalog entry: a full-width "Customize" button (real element,
 * keyboard-reachable) with the entry name (+ role/Measured badges) and its
 * blurb always visible underneath, never hidden behind a tooltip — plus a
 * trailing one-click **Add** (R5), or a "✓ in your targets" marker in its
 * place once the player already has it.
 */
function libraryEntry(
  entry: TargetLibraryEntry,
  builder: BuilderHandle,
  owned: boolean,
  addEntry: (entry: TargetLibraryEntry) => void,
): HTMLElement {
  const customize = h('button', {
    class: 'library-entry',
    title: 'Load into the builder to customize before saving',
    on: { click: () => builder.prefill(entry) },
  },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '7px' } },
      h('span', { style: { fontWeight: '600', fontSize: '13px' } }, entry.name),
      entry.role !== 'All Roles' ? badge(entry.role, 'manual') : null,
      entry.mode === 'measured' ? badge('Measured', 'auto') : null,
    ),
    h('div', { class: 'hint', style: { marginTop: '3px' } }, entry.blurb),
  );
  const trailing = owned
    ? h('span', { class: 'hint library-entry-trailing', style: { color: 'var(--win-text)', whiteSpace: 'nowrap' } }, '✓ in your targets')
    : button('Add', {
        variant: 'ghost',
        class: 'library-entry-trailing',
        title: 'Save this to your targets exactly as written — no customizing',
        onClick: () => addEntry(entry),
      });
  return h('div', { class: 'library-entry-row' }, customize, trailing);
}
