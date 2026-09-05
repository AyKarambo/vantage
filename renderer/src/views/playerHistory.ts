/**
 * Player history — the parameterized drill-down behind a player-name click (a
 * scoreboard row, the match-detail player table, or the Live roster). Lists
 * every stored match you shared with that player, newest first, as a table:
 * what they played, what you played, on which account and role, and the rank you
 * went in at. Local, GEP-only, never exported (guardrail #5). Same async-fetch
 * shape as the match-detail view: a fresh host per render, filled when the
 * bridge resolves, so rapid navigations never cross-write.
 *
 * Deliberately a COMPLETE all-time record, unscoped by the filter bar (this view
 * is in `FILTERLESS_VIEWS`) — the Players list is the filtered surface; this one
 * is the whole story with that person.
 */
import { h, render } from '../dom';
import type { PlayerMatchHistory, PlayerSharedMatch, Role, SharedMatchRank } from '../../../src/shared/contract';
import { bridge } from '../bridge';
import { rankLabel, relTime } from '../format';
import { card, emptyState, pill, RESULT_LETTER, RESULT_STATE } from '../components/primitives';
import { roleIcon } from '../components/roleIcon';
import { backControl, viewHead, type ViewContext } from './view';

export function playerHistory(ctx: ViewContext): HTMLElement {
  const host = h('div', { class: 'view' });
  const name = ctx.params.playerName;
  if (!name) {
    render(host, backRow(), card({}, emptyState('No player selected.')));
    return host;
  }
  render(host, backRow(), card({}, h('div', { class: 'hint' }, 'Loading player history…')));
  bridge.playerHistory(name).then((data) => {
    if (!data || !data.matches.length) {
      render(host, backRow(), card({}, emptyState(`No tracked matches with ${name} yet.`)));
      return;
    }
    render(host, ...sections(data, ctx));
  });
  return host;
}

/**
 * The shared ← for the three branches that never build a `viewHead` (no player,
 * loading, no shared matches). The success branch gets its back control from
 * `viewHead` instead — these are exactly the dead ends that most need a way out.
 */
function backRow(): HTMLElement {
  return h('div', { style: { marginBottom: '4px' } }, backControl());
}

function sections(d: PlayerMatchHistory, ctx: ViewContext): Node[] {
  const decided = d.results.wins + d.results.losses;
  const wr = decided ? Math.round((d.results.wins / decided) * 100) : null;
  const sub = [
    // "all time" is load-bearing: the Players list counts under the filter bar,
    // so the two numbers legitimately differ and each says which it shows.
    `${d.encounters} shared ${d.encounters === 1 ? 'game' : 'games'}, all time`,
    `last ${relTime(d.lastSeen)}`,
    `${d.results.wins}W ${d.results.losses}L${wr != null ? ` · ${wr}% WR` : ''}`,
  ].join(' · ');
  return [
    viewHead(d.name, sub),
    teamSplit(d),
    card({ class: 'card--flush', style: { padding: '4px 10px 10px' } },
      h('div', { class: 'table-wrap' },
        h('table', { class: 'data' },
          h('thead', null,
            h('tr', null,
              h('th', null, 'Map'),
              h('th', null, 'Mode'),
              h('th', null, 'Side'),
              h('th', null, 'They played'),
              h('th', null, 'You played'),
              h('th', null, 'Account'),
              h('th', null, 'Your rank'),
              h('th', null, 'When'),
            ),
          ),
          h('tbody', null, ...d.matches.map((m) => matchRow(m, ctx))),
        ),
      ),
    ),
    rankFootnote(d),
  ].filter((n): n is HTMLElement => n != null);
}

/** Your record split by whether they were on your team — omitted when unknown. */
function teamSplit(d: PlayerMatchHistory): HTMLElement | null {
  const withYou = d.sameTeam.wins + d.sameTeam.losses;
  const against = d.enemyTeam.wins + d.enemyTeam.losses;
  if (!withYou && !against) return null;
  const parts: string[] = [];
  if (withYou) parts.push(`As teammates: ${d.sameTeam.wins}W ${d.sameTeam.losses}L`);
  if (against) parts.push(`As opponents: ${d.enemyTeam.wins}W ${d.enemyTeam.losses}L`);
  return h('div', { class: 'hint', style: { margin: '0 0 12px' } }, parts.join('   ·   '));
}

/** Why a rank cell is blank — the exact copy shown as its tooltip. */
const RANK_BLANK_REASON: Record<SharedMatchRank['note'], string> = {
  stored: '',
  derived: '',
  placements: 'No rank during placements — the game shows none until the run finishes.',
  'pre-reset': 'Before your last placement reset — the ladder is discontinuous there.',
  'no-anchor': 'No rank set for this account and role.',
  'stale-anchor': 'No rank reading since your ladder reset.',
};
const RANK_STORED_TITLE = 'The rank you were sitting at when you queued — recorded at the time.';
const RANK_DERIVED_TITLE =
  'Reconstructed from your rank anchor — an estimate. A match with no logged ±% counts as 0, '
  + 'and setting a new rank rewrites it.';

/**
 * One rank cell. Never a shield and never a movement arrow: `SharedMatchRank`
 * carries no protection flag precisely so this cell cannot assert one, and a
 * derivative across two derived cells could invent a division change that never
 * happened.
 */
function rankCell(r: PlayerSharedMatch['rank']): HTMLElement {
  if (!r) return h('td', { class: 'mono u-muted', title: 'Not a competitive match.' }, '—');
  if (r.tier == null || r.division == null) {
    return h('td', { class: 'mono u-muted', title: RANK_BLANK_REASON[r.note] }, '—');
  }
  const label = `${rankLabel(r.tier, r.division)} · ${Math.round(r.progressPct ?? 0)}%`;
  if (r.note === 'stored') return h('td', { class: 'mono', title: RANK_STORED_TITLE }, label);
  return h('td', { class: 'mono u-muted', title: RANK_DERIVED_TITLE },
    label, h('span', { class: 'u-dim' }, ' est.'));
}

/** Named once under the table rather than per row, when any cell is an estimate. */
function rankFootnote(d: PlayerMatchHistory): HTMLElement | null {
  if (!d.matches.some((m) => m.rank?.note === 'derived')) return null;
  return h('div', { class: 'hint', style: { marginTop: '8px' } },
    'Ranks marked ', h('span', { class: 'u-dim' }, 'est.'),
    ' are reconstructed from your rank anchor and the ±% you logged — they move if you set a new '
    + 'rank or correct an old ±%. Unmarked ranks were recorded at the time and stay put.');
}

/** A role badge plus hero name(s), or a blank when the feed reported neither. */
function playedCell(heroes: string[], role: Role | undefined, title?: string): HTMLElement {
  if (!heroes.length && !role) {
    // A masked roster slot legitimately has no hero — blank, never "Unknown".
    return h('td', { class: 'u-muted', title: 'The game feed did not report this.' }, '—');
  }
  const cell = h('td', null,
    h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '6px', justifyContent: 'flex-end' } },
      role ? h('span', { class: 'tag tag--role' }, roleIcon(role)) : null,
      heroes.length ? h('span', null, heroes.join(', ')) : null,
    ),
  );
  if (title) cell.title = title;
  return cell;
}

/** One shared match, click-through to its detail. */
function matchRow(m: PlayerSharedMatch, ctx: ViewContext): HTMLElement {
  const state = RESULT_STATE[m.result];
  const relation = m.sameTeam === true ? 'with you' : m.sameTeam === false ? 'vs you' : null;
  const row = h('tr', { class: 'is-clickable' },
    h('td', null,
      h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '8px' } },
        h('span', { class: `match-result is-${state}` }, RESULT_LETTER[m.result]),
        h('span', null, m.map),
      ),
    ),
    h('td', null, pill(m.mapType, 'accent')),
    relation
      ? h('td', null, relation)
      // Withheld unless the feed reported a team for BOTH rows — a guess here
      // would defeat the point of the column.
      : h('td', { class: 'u-muted', title: 'The game feed did not report both teams.' }, '—'),
    // Singular by necessity: the feed only ever gave us their LAST hero.
    playedCell(m.hero ? [m.hero] : [], m.theirRole,
      m.hero ? 'The last hero the game feed reported for them.' : undefined),
    // Your own swaps ARE known, so this can be a list. The role is what the rank
    // column is keyed by — rank is tracked per account x role.
    playedCell(m.heroes, m.role),
    h('td', { class: 'u-muted' }, m.account),
    rankCell(m.rank),
    h('td', { class: 'u-dim mono' }, relTime(m.timestamp)),
  );
  row.addEventListener('click', () => ctx.navigate('matchDetail', { matchId: m.matchId }));
  row.title = `Open your ${m.map} match`;
  return row;
}
