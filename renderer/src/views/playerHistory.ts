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
import { rankLabel, relTime, RELATION_LABEL } from '../format';
import { card, chip, emptyState, pill, resultPill, RESULT_LETTER, RESULT_STATE } from '../components/primitives';
import { roleIcon } from '../components/roleIcon';
import { inlineLink } from '../components/inlineLink';
import { dataTable, type Column } from '../components/table';
import { roleOfHero } from '../../../src/core/heroes';
import { backControl, viewHead, type ViewContext } from './view';

export function playerHistory(ctx: ViewContext): HTMLElement {
  const host = h('div', { class: 'view view--fill' });
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
    render(host, sections(data, ctx));
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

/** Which shared matches the filter chip row narrows the table (and head W/L line) to (M6). */
type MatchFilter = 'all' | 'with' | 'vs' | 'unknown';
const FILTER_STEPS: ReadonlyArray<{ value: MatchFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'with', label: RELATION_LABEL.with.long },
  { value: 'vs', label: RELATION_LABEL.against.long },
  { value: 'unknown', label: 'Side unknown' },
];

function applyFilter(matches: readonly PlayerSharedMatch[], f: MatchFilter): PlayerSharedMatch[] {
  if (f === 'with') return matches.filter((m) => m.sameTeam === true);
  if (f === 'vs') return matches.filter((m) => m.sameTeam === false);
  if (f === 'unknown') return matches.filter((m) => m.sameTeam === undefined);
  return [...matches];
}

/** `sections` owns view-local filter state (M6) — one render per player, chips repaint the head W/L line + table in place without a re-fetch. */
function sections(d: PlayerMatchHistory, ctx: ViewContext): HTMLElement {
  let filter: MatchFilter = 'all';
  const wlHost = h('span');
  const chipRow = h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', margin: '0 0 12px' } });
  const tableHost = h('div');

  // M6: computed once over the LIFETIME match list (never the active filter's
  // subset) — toggling a column's presence every time a chip is clicked would
  // be jarring, and "does this account/rank ever appear" is a fact about the
  // player, not about whatever's currently narrowed into view.
  const showRank = d.matches.some((m) => m.rank?.tier != null && m.rank?.division != null);
  const accounts = [...new Set(d.matches.map((m) => m.account))];
  const singleAccount = accounts.length === 1 ? accounts[0] : null;
  const cols = matchColumns({ showAccount: !singleAccount, showRank });

  const paintChips = (): void => {
    render(chipRow, ...FILTER_STEPS.map((s) => chip(s.label, filter === s.value, () => {
      filter = s.value;
      paintChips();
      paintTable();
    })));
  };

  const paintTable = (): void => {
    const matches = applyFilter(d.matches, filter);
    const decided = matches.reduce((n, m) => n + (m.result !== 'Draw' ? 1 : 0), 0);
    const wins = matches.filter((m) => m.result === 'Win').length;
    const wr = decided ? Math.round((wins / decided) * 100) : null;
    // M6: the head's W/L line reflects the ACTIVE filter's subset — "N shared
    // games, all time" above it stays the lifetime fact (this screen is
    // deliberately unscoped), but the record itself is what the chip row
    // claims to be narrowing.
    render(wlHost, `${wins}W ${matches.filter((m) => m.result === 'Loss').length}L${wr != null ? ` · ${wr}% WR` : ''}`);
    render(tableHost, matches.length
      ? dataTable({
          columns: cols,
          rows: matches,
          initialSort: { key: 'when', dir: -1 },
          onRowClick: (m) => ctx.navigate('matchDetail', { matchId: m.matchId }),
        })
      : emptyState('No games match this filter.'));
  };

  paintChips();
  paintTable();

  const sub = h('span', null,
    `${d.encounters} shared ${d.encounters === 1 ? 'game' : 'games'}, all time`,
    singleAccount ? ` · on ${singleAccount}` : '',
    ` · last ${relTime(d.lastSeen)} · `,
    wlHost,
  );

  return h('div', null,
    viewHead(d.name, sub),
    collisionNote(d),
    whoTheyAreBand(d),
    teamSplit(d),
    chipRow,
    card({ class: 'card--flush', style: { padding: '4px 10px 10px' } }, tableHost),
    showRank ? rankFootnote(d) : noRankColumnNote(d, ctx),
  );
}

/**
 * "Matched by name" (M6) — the per-row ⚠ elsewhere in the app only ever named
 * the LIMIT ("more than one BattleTag folded together"), never which tags. A
 * player's own page is where that finally matters: these are their games, and
 * some of them may not actually be the same person.
 */
function collisionNote(d: PlayerMatchHistory): HTMLElement | null {
  if (d.tags.length < 2) return null;
  const joined = d.tags.length === 2
    ? `${d.tags[0]} and ${d.tags[1]}`
    : `${d.tags.slice(0, -1).join(', ')}, and ${d.tags[d.tags.length - 1]}`;
  return h('div', { class: 'hint', style: { margin: '0 0 12px' } },
    h('span', { class: 'u-dim' }, '⚠ '), `Matched by name — these games include ${joined}.`);
}

/**
 * "Who they are" at a glance (M6) — their top 3 heroes by game count and a
 * last-10 W/L dot strip, so answering doesn't require scanning the whole
 * shared-match table. Omitted when the feed never reported a hero for them
 * (heroes) or there are no shared matches at all (form — never actually
 * reached, `sections` only runs with `matches.length > 0`, kept for safety).
 */
function whoTheyAreBand(d: PlayerMatchHistory): HTMLElement | null {
  if (!d.theirHeroes.length && !d.form.length) return null;
  return h('div', { class: 'stack', style: { gap: '6px', margin: '0 0 12px' } },
    d.theirHeroes.length
      ? h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' } },
          ...d.theirHeroes.map((hs) => h('span', {
            class: 'tag', style: { display: 'inline-flex', alignItems: 'center', gap: '5px' },
          }, roleIcon(roleOfHero(hs.hero), { size: 12 }), `${hs.hero} ×${hs.games}`)))
      : null,
    d.form.length
      ? h('div', { style: { display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' } },
          h('span', { class: 'u-dim', style: { fontSize: '11px', marginRight: '2px' } }, `Last ${d.form.length}`),
          ...d.form.map((r) => resultPill(r)))
      : null,
  );
}

/** Your record split by whether they were on your team — omitted when unknown. */
function teamSplit(d: PlayerMatchHistory): HTMLElement | null {
  const withYou = d.sameTeam.wins + d.sameTeam.losses;
  const against = d.enemyTeam.wins + d.enemyTeam.losses;
  if (!withYou && !against) return null;
  const parts: string[] = [];
  if (withYou) parts.push(`${RELATION_LABEL.with.long}: ${d.sameTeam.wins}W ${d.sameTeam.losses}L`);
  if (against) parts.push(`${RELATION_LABEL.against.long}: ${d.enemyTeam.wins}W ${d.enemyTeam.losses}L`);
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
 * One rank cell's content. Never a shield and never a movement arrow:
 * `SharedMatchRank` carries no protection flag precisely so this cell cannot
 * assert one, and a derivative across two derived cells could invent a
 * division change that never happened.
 */
function rankCell(r: PlayerSharedMatch['rank']): Node {
  if (!r) return h('span', { class: 'mono u-muted', title: 'Not a competitive match.' }, '—');
  if (r.tier == null || r.division == null) {
    return h('span', { class: 'mono u-muted', title: RANK_BLANK_REASON[r.note] }, '—');
  }
  const label = `${rankLabel(r.tier, r.division)} · ${Math.round(r.progressPct ?? 0)}%`;
  if (r.note === 'stored') return h('span', { class: 'mono', title: RANK_STORED_TITLE }, label);
  return h('span', { class: 'mono u-muted', title: RANK_DERIVED_TITLE },
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

/** Every reason a rank cell can be blank, plus "no competitive match at all" — the dominant one across every shared match names why the whole column was dropped (M6). */
type BlankCategory = SharedMatchRank['note'] | 'not-competitive';
const NO_RANK_REASON_TEXT: Record<BlankCategory, string> = {
  stored: 'no rank was recorded for these matches',
  derived: 'no rank could be reconstructed for these matches',
  placements: 'most were during an open placement run',
  'pre-reset': 'most predate your last placement reset',
  'no-anchor': 'no rank is set for this account and role',
  'stale-anchor': 'there has been no rank reading since your last ladder reset',
  'not-competitive': 'none of these matches were competitive',
};

function dominantBlankCategory(matches: readonly PlayerSharedMatch[]): BlankCategory | null {
  const counts = new Map<BlankCategory, number>();
  for (const m of matches) counts.set(m.rank ? m.rank.note : 'not-competitive', (counts.get(m.rank ? m.rank.note : 'not-competitive') ?? 0) + 1);
  if (!counts.size) return null;
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * Replaces the "Your rank" column entirely (M6, `hide it when no row has a
 * tier`) with one sentence naming the dominant reason none of them do —
 * "no rank is set for this account and role" is recoverable, unlike the
 * others, so it's the one case that also offers a way out.
 */
function noRankColumnNote(d: PlayerMatchHistory, ctx: ViewContext): HTMLElement | null {
  const cat = dominantBlankCategory(d.matches);
  if (!cat) return null;
  return h('div', { class: 'hint', style: { marginTop: '8px' } },
    `No rank column shown — ${NO_RANK_REASON_TEXT[cat]}.`,
    cat === 'no-anchor'
      ? h('span', null, ' ', inlineLink('Set a rank anchor →', { onClick: () => ctx.navigate('settings', { section: 'accounts' }) }))
      : null,
  );
}

/** A role badge plus hero name(s), or a blank when the feed reported neither. */
function playedCell(heroes: string[], role: Role | undefined, title?: string): Node {
  if (!heroes.length && !role) {
    // A masked roster slot legitimately has no hero — blank, never "Unknown".
    return h('span', { class: 'u-muted', title: 'The game feed did not report this.' }, '—');
  }
  const cell = h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '6px', justifyContent: 'flex-end' } },
    role ? h('span', { class: 'tag tag--role' }, roleIcon(role)) : null,
    heroes.length ? h('span', null, heroes.join(', ')) : null,
  );
  if (title) cell.title = title;
  return cell;
}

/** Side cell content, or a blank when the feed didn't report both teams. */
function sideCell(m: PlayerSharedMatch): Node {
  const relation = m.sameTeam === true ? RELATION_LABEL.with.short : m.sameTeam === false ? RELATION_LABEL.against.short : null;
  return relation
    ? h('span', null, relation)
    : h('span', { class: 'u-muted', title: 'The game feed did not report both teams.' }, '—');
}

/**
 * Table columns (M6) — Map, Mode, Side, Account and When are locally sortable
 * (`dataTable`, no `onSort`: the whole uncapped list is already in the
 * renderer, unlike Players' capped page); They played / You played / Your
 * rank stay `sortable: false` — compound, rendered cells with no single
 * scalar a header click could honestly order by. Account and Your rank are
 * each OMITTED entirely when they'd carry no information across the whole
 * lifetime record (M6, `sections`' `showAccount`/`showRank`) — a single
 * account, or no row with an actual rank tier, isn't worth a column that
 * says the same blank thing every row down.
 */
function matchColumns(opts: { showAccount: boolean; showRank: boolean }): Array<Column<PlayerSharedMatch>> {
  const cols: Array<Column<PlayerSharedMatch>> = [
    {
      key: 'map', label: 'Map', get: (m) => m.map,
      render: (m) => h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '8px' } },
        h('span', { class: `match-result is-${RESULT_STATE[m.result]}` }, RESULT_LETTER[m.result]),
        h('span', null, m.map),
      ),
    },
    { key: 'mode', label: 'Mode', get: (m) => m.mapType, render: (m) => pill(m.mapType, 'accent') },
    { key: 'side', label: 'Side', get: (m) => (m.sameTeam === true ? 'with' : m.sameTeam === false ? 'vs' : ''), render: (m) => sideCell(m) },
    {
      key: 'theirs', label: 'They played', get: () => null, sortable: false,
      render: (m) => playedCell(m.hero ? [m.hero] : [], m.theirRole, m.hero ? 'The last hero the game feed reported for them.' : undefined),
    },
    {
      key: 'yours', label: 'You played', get: () => null, sortable: false,
      render: (m) => playedCell(m.heroes, m.role),
    },
  ];
  if (opts.showAccount) cols.push({ key: 'account', label: 'Account', get: (m) => m.account, render: (m) => h('span', { class: 'u-muted' }, m.account) });
  if (opts.showRank) cols.push({ key: 'rank', label: 'Your rank', get: () => null, sortable: false, render: (m) => rankCell(m.rank) });
  cols.push({ key: 'when', label: 'When', get: (m) => m.timestamp, render: (m) => h('span', { class: 'u-dim mono' }, relTime(m.timestamp)) });
  return cols;
}
