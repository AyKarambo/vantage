import { h } from '../../../dom';
import type { HeroEntry, HeroRole, MasterData } from '../../../../../src/shared/contract';
import { bridge } from '../../../bridge';
import { button, select } from '../../../components/primitives';
import { mdGroup, mdRow, textInput } from './shared';

/** Roles a hero can hold (no `openQ` — that's a queue, not a hero role). */
const HERO_ROLE_OPTIONS: Array<{ value: HeroRole; label: string }> = [
  { value: 'tank', label: 'Tank' }, { value: 'damage', label: 'Damage' }, { value: 'support', label: 'Support' },
];

export function heroSection(heroes: HeroEntry[], apply: (d: MasterData) => void): HTMLElement {
  const rows = heroes.map((hero) =>
    mdRow(false,
      h('div', { style: { flex: '1 1 140px', minWidth: '120px' } }, hero.name),
      select(HERO_ROLE_OPTIONS, hero.role, (role) =>
        void bridge.masterDataUpsertHero({ name: hero.name, role: role as HeroRole }).then(apply)),
      button('Remove', { variant: 'ghost', onClick: () => void bridge.masterDataRemoveHero(hero.name).then(apply) }),
    ),
  );
  const name = textInput('', 'New hero name');
  let role: HeroRole = 'damage';
  const add = h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', borderTop: '1px solid var(--border)', paddingTop: '8px' } },
    name,
    select(HERO_ROLE_OPTIONS, role, (v) => (role = v as HeroRole)),
    button('Add hero', { variant: 'soft', onClick: () => {
      const n = name.value.trim();
      if (!n) return;
      void bridge.masterDataUpsertHero({ name: n, role }).then(apply);
    } }),
  );
  return mdGroup('Heroes', 'The quick-log hero list. Changing a role only affects new logs — past matches keep their recorded role.', rows, add);
}
