/**
 * Role-filtered multi-select hero picker — a chip grid where each hero toggles
 * in place. Shared by the quick-log card and the match editor so both capture
 * the full set of heroes played (a match can involve several), filtered to the
 * chosen role (Open Queue shows every hero). Already-selected heroes always
 * appear (even off-role), so switching role never hides an existing pick.
 */
import { h, render } from '../dom';
import { ALL_HEROES, HEROES_BY_ROLE } from '../../../src/core/heroes';
import type { Role } from '../../../src/shared/contract';

/** Heroes offered for a role — role-filtered, except Open Queue (all heroes). */
export function heroesForRole(role: Role): readonly string[] {
  return role === 'openQ' ? ALL_HEROES : HEROES_BY_ROLE[role];
}

/**
 * Render the chip grid into `host`, toggling membership of `selected` in place.
 * Call again (repaint) when the role changes so the offered heroes re-filter;
 * individual chip toggles flip `is-on` without a repaint.
 */
export function paintHeroChips(host: HTMLElement, selected: Set<string>, role: Role): void {
  const pool = [...new Set<string>([...heroesForRole(role), ...selected])]
    .sort((a, b) => a.localeCompare(b));
  render(host,
    h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px' } },
      ...pool.map((hero) => {
        const el = h('button', { class: `chip${selected.has(hero) ? ' is-on' : ''}` }, hero);
        el.addEventListener('click', () => {
          selected.has(hero) ? selected.delete(hero) : selected.add(hero);
          el.classList.toggle('is-on');
        });
        return el;
      }),
    ),
  );
}
