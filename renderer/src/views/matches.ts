/** Matches — the recent game log (my interpretation of the Matches screen). */
import { h } from '../dom';
import type { MatchRow } from '../../../src/shared/contract';
import { relTime, roleLabel } from '../format';
import { card, pill } from '../components/primitives';
import { viewHead, type ViewContext } from './view';

const RESULT_LETTER: Record<string, string> = { Win: 'W', Loss: 'L', Draw: 'D' };
const RESULT_STATE: Record<string, 'win' | 'loss' | 'draw'> = { Win: 'win', Loss: 'loss', Draw: 'draw' };

export function matches(ctx: ViewContext): HTMLElement {
  const rows = ctx.data.matches;
  return h('div', { class: 'view' },
    viewHead('Matches', `${rows.length} games in range · newest first`),
    card({ class: 'card--flush', style: { padding: '8px' } },
      rows.length
        ? h('div', null, ...rows.map(matchRow))
        : h('div', { class: 'empty', style: { padding: '20px' } }, 'No matches in this range yet.'),
    ),
  );
}

function matchRow(m: MatchRow): HTMLElement {
  const state = RESULT_STATE[m.result];
  return h('div', { class: 'match-row' },
    h('div', { class: `match-result is-${state}` }, RESULT_LETTER[m.result]),
    h('div', { class: 'row-main' },
      h('div', { class: 'row-name' }, m.map),
      h('div', { class: 'row-meta' }, `${roleLabel(m.role)} · ${m.heroes.join(', ') || '—'} · ${m.account}`),
    ),
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
      pill(m.mapType, 'accent'),
      h('span', { class: 'u-dim', style: { fontSize: '11px' } }, m.gameType),
    ),
    h('div', { class: 'mono u-muted', style: { fontSize: '11px', minWidth: '46px', textAlign: 'right' } }, relTime(m.timestamp)),
  );
}
