import { h } from '../../../dom';
import type { MapEntry, MapMode, MasterData } from '../../../../../src/shared/contract';
import { bridge } from '../../../bridge';
import { button, chip, select } from '../../../components/primitives';
import { mdGroup, mdRow, textInput } from './shared';

/** Selectable map game modes. */
const MAP_MODE_OPTIONS: Array<{ value: MapMode; label: string }> = [
  { value: 'Control', label: 'Control' }, { value: 'Escort', label: 'Escort' }, { value: 'Hybrid', label: 'Hybrid' },
  { value: 'Push', label: 'Push' }, { value: 'Flashpoint', label: 'Flashpoint' }, { value: 'Clash', label: 'Clash' },
  { value: 'Unknown', label: 'Unknown' },
];

export function mapSection(maps: MapEntry[], apply: (d: MasterData) => void): HTMLElement {
  const rows = maps.map((map) =>
    mdRow(!map.isActive,
      h('div', { style: { flex: '1 1 140px', minWidth: '120px' } }, map.name),
      select(MAP_MODE_OPTIONS, map.mode, (mode) =>
        void bridge.masterDataUpsertMap({ ...map, mode: mode as MapMode }).then(apply)),
      chip(map.isActive ? 'In pool' : 'Out of pool', map.isActive, () =>
        void bridge.masterDataUpsertMap({ ...map, isActive: !map.isActive }).then(apply)),
      button('Remove', { variant: 'ghost', onClick: () => void bridge.masterDataRemoveMap(map.name).then(apply) }),
    ),
  );
  const name = textInput('', 'New map name');
  let mode: MapMode = 'Control';
  const add = h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', borderTop: '1px solid var(--border)', paddingTop: '8px' } },
    name,
    select(MAP_MODE_OPTIONS, mode, (v) => (mode = v as MapMode)),
    button('Add map', { variant: 'soft', onClick: () => {
      const n = name.value.trim();
      if (!n) return;
      void bridge.masterDataUpsertMap({ name: n, mode, isActive: true }).then(apply);
    } }),
  );
  return mdGroup(
    'Maps',
    '“In pool” = part of the current competitive map pool. Out-of-pool maps stay in your history but aren’t suggested for new logs.',
    rows,
    add,
  );
}
