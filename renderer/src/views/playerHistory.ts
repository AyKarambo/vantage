/**
 * Player history — the parameterized drill-down behind a player-name click (a
 * scoreboard row or the "players you've met" list). Lists every stored match you
 * shared with that player, newest first, with a W/L summary split by team
 * relation. Local, GEP-only, never exported (guardrail #5). Same async-fetch
 * shape as the match-detail view: a fresh host per render, filled when the
 * bridge resolves, so rapid navigations never cross-write.
 */
import { h, render } from '../dom';
import type { PlayerMatchHistory, PlayerSharedMatch } from '../../../src/shared/contract';
import { bridge } from '../bridge';
import { relTime } from '../format';
import { button, card, emptyState, pill, RESULT_LETTER, RESULT_STATE } from '../components/primitives';
import { viewHead, type ViewContext } from './view';

export function playerHistory(ctx: ViewContext): HTMLElement {
  const host = h('div', { class: 'view' });
  const name = ctx.params.playerName;
  if (!name) {
    render(host, backRow(ctx), card({}, emptyState('No player selected.')));
    return host;
  }
  render(host, backRow(ctx), card({}, h('div', { class: 'hint' }, 'Loading player history…')));
  bridge.playerHistory(name).then((data) => {
    if (!data || !data.matches.length) {
      render(host, backRow(ctx), card({}, emptyState(`No tracked matches with ${name} yet.`)));
      return;
    }
    render(host, backRow(ctx), ...sections(data, ctx));
  });
  return host;
}

/** Back to the match the click came from is not tracked; return to Matches. */
function backRow(ctx: ViewContext): HTMLElement {
  return h('div', { style: { marginBottom: '4px' } },
    button('← Matches', { variant: 'ghost', onClick: () => ctx.navigate('matches') }),
  );
}

function sections(d: PlayerMatchHistory, ctx: ViewContext): Node[] {
  const decided = d.results.wins + d.results.losses;
  const wr = decided ? Math.round((d.results.wins / decided) * 100) : null;
  const sub = [
    `${d.encounters} shared ${d.encounters === 1 ? 'match' : 'matches'}`,
    `last ${relTime(d.lastSeen)}`,
    `${d.results.wins}W ${d.results.losses}L${wr != null ? ` · ${wr}% WR` : ''}`,
  ].join(' · ');
  return [
    viewHead(d.name, sub),
    teamSplit(d),
    card({ class: 'card--flush', style: { padding: '8px' } },
      h('div', null, ...d.matches.map((m) => matchRow(m, ctx))),
    ),
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

/** One shared match, click-through to its detail — mirrors the Matches row look. */
function matchRow(m: PlayerSharedMatch, ctx: ViewContext): HTMLElement {
  const state = RESULT_STATE[m.result];
  const relation = m.sameTeam === true ? 'with you' : m.sameTeam === false ? 'vs you' : null;
  const meta = [m.hero, relation, m.account].filter((s): s is string => Boolean(s));
  return h('div', {
    class: 'match-row is-clickable',
    style: { gridTemplateColumns: '44px 1fr 84px 46px' },
    on: { click: () => ctx.navigate('matchDetail', { matchId: m.matchId }) },
  },
    h('div', { class: `match-result is-${state}` }, RESULT_LETTER[m.result]),
    h('div', { class: 'row-main' },
      h('div', { class: 'row-name' }, m.map),
      meta.length ? h('div', { class: 'row-meta' }, meta.join(' · ')) : null,
    ),
    h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', width: '84px' } },
      pill(m.mapType, 'accent'),
    ),
    h('div', { class: 'mono u-muted', style: { fontSize: '11px', width: '46px', textAlign: 'right' } }, relTime(m.timestamp)),
  );
}
