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

/**
 * Render the chip grid into `host`, toggling membership of `selected` in place.
 * Call again (repaint) when the role or hero list changes so the offered heroes
 * re-filter; individual chip toggles flip `is-on` without a repaint.
 */
export function paintHeroChips(host: HTMLElement, selected: Set<string>, role: Role, heroes: HeroEntry[]): void {
  const pool = [...new Set<string>([...heroesForRole(role, heroes), ...selected])]
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
