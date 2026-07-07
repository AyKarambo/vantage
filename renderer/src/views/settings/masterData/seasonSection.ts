import { h } from '../../../dom';
import type { MasterData, SeasonEntry } from '../../../../../src/shared/contract';
import { bridge } from '../../../bridge';
import { button } from '../../../components/primitives';
import { mdGroup, mdRow, textInput } from './shared';

/** ISO `YYYY-MM-DD` for a UTC season start instant. */
function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function seasonSection(seasons: SeasonEntry[], apply: (d: MasterData) => void): HTMLElement {
  // Newest first, matching the season filter.
  const rows = [...seasons].sort((a, b) => b.start - a.start).map((season) => {
    const label = textInput(season.label, 'Season label');
    const commit = (): void => {
      const l = label.value.trim();
      if (l && l !== season.label) void bridge.masterDataUpsertSeason({ start: season.start, label: l }).then(apply);
    };
    label.addEventListener('change', commit);
    return mdRow(false,
      h('div', { class: 'mono u-dim', style: { flex: '0 0 96px', fontSize: '12px' } }, isoDate(season.start)),
      h('div', { style: { flex: '1 1 160px' } }, label),
      button('Remove', { variant: 'ghost', onClick: () =>
        void bridge.masterDataRemoveSeason(`S:${isoDate(season.start)}`).then(apply) }),
    );
  });
  const date = h('input', { class: 'vt-input', type: 'date' }) as HTMLInputElement;
  const label = textInput('', 'Season label (e.g. 2026 Season 4)');
  const add = h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', borderTop: '1px solid var(--border)', paddingTop: '8px' } },
    date, label,
    button('Add season', { variant: 'soft', onClick: () => {
      const start = Date.parse(date.value);
      const l = label.value.trim();
      if (Number.isNaN(start) || !l) return;
      void bridge.masterDataUpsertSeason({ start, label: l }).then(apply);
    } }),
  );
  return mdGroup(
    'Seasons',
    'Competitive season boundaries for the “This season” filter. The current season is auto-extrapolated; add one here to correct or get ahead of a new start.',
    rows,
    add,
  );
}
