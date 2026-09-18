/**
 * Role-filtered multi-select hero picker — a chip grid where each hero toggles
 * in place. Shared by the quick-log card and the match editor so both capture
 * the full set of heroes played (a match can involve several), filtered to the
 * chosen role (Open Queue shows every hero). The hero list comes from the
 * effective master data, so heroes added/edited in Settings appear here too.
 * Already-selected heroes always appear (even off-role), so switching role never
 * hides an existing pick.
 */
import { h, render } from '../dom';
import { roleIcon } from './roleIcon';
import { roleLabel } from '../format';
import type { HeroEntry, Role } from '../../../src/shared/contract';

/** Hero names offered for a role — role-filtered, except Open Queue (all heroes). */
export function heroesForRole(role: Role, heroes: HeroEntry[]): string[] {
  const pool = role === 'openQ' ? heroes : heroes.filter((hero) => hero.role === role);
  return pool.map((hero) => hero.name);
}

/** Options that switch {@link paintHeroChips} from the full grid to a shortlist + search. */
export interface HeroPickerOpts {
  /**
   * A pre-ranked, pre-sized pool (e.g. "most played") to show instead of every
   * role-eligible hero. Omit to keep today's full-grid behavior.
   */
  shortlist?: readonly string[];
  /**
   * The shortlist's intended size (Settings → Quick Log's "suggested heroes"
   * count). A shortlist shorter than this — a fresh account/role has no
   * most-played history at all, so `shortlist` arrives empty — is topped up
   * with the rest of the role-eligible pool (alphabetically) so the grid is
   * never emptier than search alone would leave it. Defaults to the
   * shortlist's own length (no top-up) when omitted.
   */
  limit?: number;
  /** Show a text filter above the grid that searches the full role-eligible pool. */
  search?: boolean;
}

function heroChip(hero: string, selected: Set<string>): HTMLElement {
  const el = h('button', { class: `chip${selected.has(hero) ? ' is-on' : ''}` }, hero);
  el.addEventListener('click', () => {
    selected.has(hero) ? selected.delete(hero) : selected.add(hero);
    el.classList.toggle('is-on');
  });
  return el;
}

/**
 * Render the chip grid into `host`, toggling membership of `selected` in place.
 * Call again (repaint) when the role or hero list changes so the offered heroes
 * re-filter; individual chip toggles flip `is-on` without a repaint.
 *
 * Without `opts`, this is the original full role-filtered grid — kept as the
 * fallback for callers without most-played data. With `opts.shortlist`, the
 * grid shows only that pool (unioned with `selected`, so existing picks stay
 * visible/removable); with `opts.search` a text filter reveals the rest of the
 * role-eligible pool on demand, toggled the same way as a shortlist chip.
 * Both the quick-log card and the match editor now pass `{ shortlist, search: true }`.
 */
const OPEN_QUEUE_GROUPS: readonly Role[] = ['tank', 'damage', 'support'];

/**
 * Pure: the shortlist actually shown — topped up with the rest of the
 * role-eligible pool (alphabetically) when it started shorter than `limit`,
 * unchanged otherwise. `undefined` (no shortlist at all) means "show the full
 * eligible pool", the original full-grid behavior. Exported so the decision
 * is unit-testable without a DOM.
 */
export function toppedUpShortlist(
  shortlist: readonly string[] | undefined, limit: number, eligible: readonly string[],
): readonly string[] {
  if (shortlist === undefined) return eligible;
  if (shortlist.length >= limit) return shortlist;
  const rest = eligible.filter((h) => !shortlist.includes(h)).sort((a, b) => a.localeCompare(b));
  return [...shortlist, ...rest].slice(0, Math.max(limit, shortlist.length));
}

export function paintHeroChips(
  host: HTMLElement, selected: Set<string>, role: Role, heroes: HeroEntry[], opts?: HeroPickerOpts,
): void {
  const eligible = heroesForRole(role, heroes);
  const limit = opts?.limit ?? opts?.shortlist?.length ?? 0;
  // A shortlist shorter than its intended size (most commonly: no history at
  // all yet — a fresh account, or a role never queued) is topped up with the
  // rest of the role-eligible pool, alphabetically, rather than left to show
  // an empty grid with search as the only way to reach any hero at all.
  const basePool = toppedUpShortlist(opts?.shortlist, limit, eligible);
  // Recomputed on every paint (not captured once) so a hero picked via search
  // still shows up once the search box is cleared back to the base view.
  const currentBaseView = (): string[] =>
    [...new Set<string>([...basePool, ...selected])].sort((a, b) => a.localeCompare(b));

  // Open Queue's pool is every hero with no role structure at all — a flat
  // sorted grid reads as a wall of chips. `roleOf` looks up each name's own
  // role (every HeroEntry has one) so the grid can group by it instead.
  const roleOf = new Map(heroes.map((h) => [h.name, h.role]));
  const grid = h('div', role === 'openQ' ? { class: 'hero-role-groups' } : { style: { display: 'flex', flexWrap: 'wrap', gap: '8px' } });
  const paintGrid = (names: string[]): void => {
    if (role !== 'openQ') {
      render(grid, ...names.map((hero) => heroChip(hero, selected)));
      return;
    }
    // Grouped by role, tank/damage/support in that order; within a group the
    // incoming order is kept (most-played first in the base view, or the
    // search results' own relevance order) rather than re-sorted.
    const byRole = new Map<Role, string[]>();
    for (const name of names) {
      const r = roleOf.get(name);
      if (!r) continue;
      (byRole.get(r) ?? byRole.set(r, []).get(r)!).push(name);
    }
    render(grid,
      ...OPEN_QUEUE_GROUPS.filter((r) => (byRole.get(r) ?? []).length > 0).map((r) =>
        h('div', { class: 'hero-role-group' },
          h('div', { class: 'hero-role-group-head' }, roleIcon(r, { size: 13 }), roleLabel(r)),
          h('div', { class: 'hero-role-group-chips' }, ...(byRole.get(r) ?? []).map((hero) => heroChip(hero, selected))),
        ),
      ),
    );
  };
  paintGrid(currentBaseView());

  if (!opts?.search) {
    render(host, grid);
    return;
  }

  const searchInput = h('input', {
    class: 'vt-input', type: 'text', placeholder: 'search heroes…',
  }) as HTMLInputElement;
  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase();
    if (!q) {
      paintGrid(currentBaseView());
      return;
    }
    const matches = [...new Set<string>([...eligible.filter((h) => h.toLowerCase().includes(q)), ...selected])]
      .sort((a, b) => a.localeCompare(b));
    paintGrid(matches);
  });

  render(host,
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } }, searchInput, grid),
  );
}
