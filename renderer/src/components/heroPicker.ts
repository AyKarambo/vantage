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
import type { HeroEntry, Role } from '../../../src/shared/contract';

/** Hero names offered for a role — role-filtered, except Open Queue (all heroes). */
export function heroesForRole(role: Role, heroes: HeroEntry[]): string[] {
  const pool = role === 'openQ' ? heroes : heroes.filter((hero) => hero.role === role);
  return pool.map((hero) => hero.name);
}

/** Options that switch {@link paintHeroChips} from the full grid to a shortlist + search. */
export interface HeroPickerOpts {
  /**
   * A pre-ranked pool (e.g. "most played"), NOT pre-sliced by the caller — to
   * show instead of every role-eligible hero. Omit to keep today's full-grid
   * behavior.
   */
  shortlist?: readonly string[];
  /**
   * How many chips the shortlist should show. Required alongside `shortlist`.
   * L4: a `shortlist` shorter than this (a fresh account, or a role never
   * queued on this account, has no "most played" history at all) is padded
   * out with the rest of the role-eligible pool, alphabetically, so a new
   * track still opens to a usable grid instead of an empty one that forces
   * typing every hero into search.
   */
  shortlistLimit?: number;
  /** Show a text filter above the grid that searches the full role-eligible pool. */
  search?: boolean;
}

/** `ranked` sliced to `limit`, padded with the rest of `eligible` (alphabetically) when it falls short — see {@link HeroPickerOpts.shortlistLimit}. */
export function padShortlist(ranked: readonly string[], limit: number, eligible: readonly string[]): string[] {
  const sliced = ranked.slice(0, limit);
  if (sliced.length >= limit) return sliced;
  const have = new Set(sliced);
  const fill = eligible.filter((h) => !have.has(h)).sort((a, b) => a.localeCompare(b));
  return [...sliced, ...fill].slice(0, limit);
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
export function paintHeroChips(
  host: HTMLElement, selected: Set<string>, role: Role, heroes: HeroEntry[], opts?: HeroPickerOpts,
): void {
  const eligible = heroesForRole(role, heroes);
  const basePool = opts?.shortlist
    ? padShortlist(opts.shortlist, opts.shortlistLimit ?? opts.shortlist.length, eligible)
    : eligible;
  // Recomputed on every paint (not captured once) so a hero picked via search
  // still shows up once the search box is cleared back to the base view.
  const currentBaseView = (): string[] =>
    [...new Set<string>([...basePool, ...selected])].sort((a, b) => a.localeCompare(b));

  const grid = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px' } });
  const paintGrid = (names: string[]): void => {
    render(grid, ...names.map((hero) => heroChip(hero, selected)));
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
