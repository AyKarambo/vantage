/** Heroes — the exact per-hero table, with a click-through drill-down drawer. */
import { h, render } from '../dom';
import type { HeroDetail, HeroSummary } from '../../../src/shared/contract';
import { bridge } from '../bridge';
import { duration, fmt, fmt1, pct, roleLabel } from '../format';
import { wrColor } from '../theme';
import { prefs } from '../prefs';
import { store } from '../store';
import { card, chip, emptyState, resultPill, statBox } from '../components/primitives';
import { roleIcon } from '../components/roleIcon';
import { dataTable, type Column } from '../components/table';
import { infoTip } from '../components/infoTip';
import { inlineLink } from '../components/inlineLink';
import { openDrawer } from '../components/overlay';
import { trendArrow } from '../components/trendArrow';
import { viewHead, type ViewContext } from './view';

const MIN_GAMES_STEPS = [1, 5, 10] as const;

/** Sort order for the Trend column (H6) — worsening first under a descending arrow, matching the WR/net convention elsewhere. */
const TREND_ORDER: Record<string, number> = { declining: -1, flat: 0, improving: 1 };

export function heroes(ctx: ViewContext): HTMLElement {
  // Self-rating averages join by hero key (a multi-hero match's single rating
  // counts toward each hero, same convention as the winrate/per-10 columns).
  const ratingByHero = new Map(ctx.data.performance.byHero.map((b) => [b.key, b.avg]));
  // Column order is the display order; `get` drives sort, `render` is optional display formatting.
  const columns: Array<Column<HeroSummary>> = [
    { key: 'hero', label: 'Hero', get: (r) => r.hero },
    { key: 'role', label: 'Role', get: (r) => r.role ?? '', render: (r) => h('span', { class: 'tag tag--role' }, roleIcon(r.role)) },
    // 'Games', matching the Maps table's header (K7) — 'G' alone was the odd
    // one out among 'Games' / 'Games together' / a bare letter for the same
    // quantity across the app.
    { key: 'games', label: 'Games', get: (r) => r.games },
    // W-L (H5): the games column alone can't say whether a rounded credit is
    // signal or a coin-flip sample — Focus and Matches already show W-L.
    { key: 'wl', label: 'W-L', sortable: false, get: () => null, render: (r) => h('span', { class: 'mono', style: { color: wrColor(r.winrate) } }, `${r.wins}W ${r.losses}L`) },
    { key: 'winrate', label: 'WR', get: (r) => r.winrate, render: (r) => h('span', { style: { color: wrColor(r.winrate) } }, pct(r.winrate)) },
    // Trend (H6): recent-vs-earlier verdict, reusing Focus's dimension-agnostic
    // read — 'is my Genji getting better this season?' used to need a drawer
    // open per hero; this answers it at a glance across the whole table.
    { key: 'trend', label: 'Trend', get: (r) => (r.trend ? TREND_ORDER[r.trend] : null), render: (r) => trendArrow(r.trend) ?? '–' },
    // Time (H5): total played minutes on the hero — the sample-size signal a
    // rounded game count can't carry (a 3-game hero at 9 minutes reads very
    // differently from one at 40).
    { key: 'minutes', label: 'Time', get: (r) => r.minutes, render: (r) => duration(r.minutes) },
    { key: 'kda', label: 'KDA', get: (r) => r.kda, render: (r) => r.kda.toFixed(1) },
    // render: dataTable no longer rounds a raw numeric cell for you (K1) — a
    // per-10 rate genuinely has decimals (fmt1, H5), same convention the
    // drawer's KDA and the match detail per-hero card already follow.
    { key: 'elims', label: 'E/10', get: (r) => r.per10?.eliminations ?? null, render: (r) => fmt1(r.per10?.eliminations) },
    { key: 'deaths', label: 'D/10', get: (r) => r.per10?.deaths ?? null, render: (r) => fmt1(r.per10?.deaths) },
    { key: 'assists', label: 'A/10', get: (r) => r.per10?.assists ?? null, render: (r) => fmt1(r.per10?.assists) },
    { key: 'damage', label: 'DMG/10', get: (r) => r.per10?.damage ?? null, render: (r) => fmt(r.per10?.damage) },
    { key: 'healing', label: 'HEAL/10', get: (r) => r.per10?.healing ?? null, render: (r) => fmt(r.per10?.healing) },
    { key: 'mitigation', label: 'MIT/10', get: (r) => r.per10?.mitigation ?? null, render: (r) => fmt(r.per10?.mitigation) },
    {
      key: 'rating',
      // K8: 'RTG' alone was a bare abbreviation nobody could hover to
      // explain — a native `title` on a <th> is invisible to keyboard users
      // and gets clipped by the frameless window edge anyway.
      label: h('span', null, 'RTG', infoTip(
        'Your average self-rating (the 0–100 slider on Log Match / Review) on games with this hero, in the current range.',
        { label: 'What is RTG?' },
      )),
      get: (r) => ratingByHero.get(r.hero) ?? null,
      render: (r) => fmt(ratingByHero.get(r.hero)),
    },
  ];

  const minGames = prefs.get('minGames') ?? 1;
  const rows = ctx.data.heroStats.filter((r) => r.games >= minGames);
  const hidden = ctx.data.heroStats.length - rows.length;

  const minGamesChips = h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } },
    h('span', { class: 'u-dim', style: { fontSize: '11px' } }, 'min. games'),
    ...MIN_GAMES_STEPS.map((n) =>
      chip(`${n}+`, minGames === n, () => {
        prefs.set('minGames', n);
        store.rerender();
      }),
    ),
    // H5: the three numbering conventions this table leans on (per-10 minutes
    // PLAYED, not the wall clock; games/wins credited by hero time-share, not
    // whole-match counts; Time as the real sample-size signal a rounded game
    // count can't carry) used to live only in the source doc comment.
    infoTip(
      'Rates are per 10 minutes PLAYED (fight time, not the wall clock). Games and wins are credited by your time-share on the hero within each match — a hero played for a quarter of a won game earns 0.25 of a win, so the counts can be fractional-looking. Time is the real minutes behind that credit: a low game count with a lot of minutes is a steadier sample than the same count on quick swaps.',
      { label: 'How are these numbers computed?' },
    ),
  );

  return h('div', { class: 'view view--fill view--wide' },
    viewHead('Heroes',
      `Exact stats, per 10 minutes played · click a hero to drill down${hidden > 0 ? ` · ${hidden} low-sample hidden` : ''}`,
      minGamesChips),
    card({ class: 'card--flush', style: { padding: '4px 10px 10px' } },
      dataTable({
        columns,
        rows,
        initialSort: { key: 'games', dir: -1 },
        persistSortAs: 'heroSort',
        onRowClick: (row) => openHeroDrawer(ctx, row.hero),
        // K9: a header over an empty tbody with no explanation used to be the
        // whole story here — choosing 10+ on a short range, or a role filter
        // that empties the list, now says why and offers a real way back.
        empty: !rows.length
          ? emptyState(ctx.data.heroStats.length
              // Heroes exist in range; the min-games floor is hiding all of them.
              ? {
                  body: `No hero has ${minGames}+ games in this range.`,
                  action: { label: 'Show 1+', run: () => { prefs.set('minGames', 1); store.rerender(); } },
                }
              // No games in range at all — offer the wider window when one exists,
              // same recovery Overview/Matches/Players already give.
              : {
                  body: 'No games in this range yet.',
                  ...(ctx.data.totalGamesAllTime > 0 && ctx.data.filters.days !== 'all'
                    ? { action: { label: 'Show all time', run: () => ctx.setFilter({ days: 'all' }) } }
                    : {}),
                })
          : undefined,
      }),
    ),
  );
}

/** Open the hero drill-down drawer (also reachable from the command palette / cross-links). */
export function openHeroDrawer(ctx: ViewContext, hero: string): void {
  openDrawer((close) => {
    const body = h('div', null, h('div', { class: 'hint' }, 'Loading…'));
    bridge.heroDetail(hero, ctx.data.filters).then((d) => render(body, heroDetail(ctx, d, close)));
    return body;
  });
}

/** "Damage · last 30 days · all accounts" — Players' scope-text convention
 *  (H7), so the drawer states plainly that these numbers follow the filter
 *  bar rather than being a hero's all-time record. */
function heroDrawerScope(ctx: ViewContext): string {
  const f = ctx.data.filters;
  const days = f.days;
  let season: string;
  if (typeof days === 'object') {
    season = ctx.data.options.seasons.find((x) => x.id === days.season)?.label ?? 'one season';
  } else {
    season = days === 'all' ? 'all time' : `last ${days} days`;
  }
  return [
    f.role === 'all' ? 'all roles' : roleLabel(f.role),
    season,
    f.account === 'all' ? 'all accounts' : f.account,
  ].join(' · ');
}

function heroDetail(ctx: ViewContext, d: HeroDetail, close: () => void): HTMLElement {
  const s = d.stats;
  const p = s?.per10;
  // Games desc (weightedGroupBy's own order) with winrate as a tiebreak — the
  // common all-1-game case used to read as random, since every map's credit
  // ties and nothing broke the tie (H7).
  const byMap = [...d.byMap].sort((a, b) => b.games - a.games || b.winrate - a.winrate);
  return h('div', null,
    h('div', { style: { display: 'flex', alignItems: 'baseline', gap: '8px' } },
      roleIcon(s?.role),
      h('h3', { style: { fontSize: '18px' } }, d.hero),
    ),
    h('p', { class: 'u-muted', style: { fontSize: '12px', margin: '2px 0 2px' } },
      `${d.overall.games} games · ${pct(d.overall.winrate)} winrate · ${d.overall.wins}W ${d.overall.losses}L`),
    h('p', { class: 'u-dim', style: { fontSize: '11px', margin: '0 0 14px' } }, heroDrawerScope(ctx)),
    s
      ? h('div', { class: 'stat-grid' },
          statBox(s.kda.toFixed(1), 'KDA'),
          statBox(fmt1(p?.eliminations), 'Elims/10'),
          statBox(fmt1(p?.deaths), 'Deaths/10'),
          statBox(fmt(p?.damage), 'Dmg/10'),
          statBox(fmt(p?.healing), 'Heal/10'),
          statBox(fmt(p?.mitigation), 'Mit/10'),
        )
      : null,
    section('By map', byMap.length
      ? byMap.map((m) => h('div', { class: 'row', style: { padding: '6px 0' } },
          inlineLink(m.key, {
            class: 'row-main',
            style: { fontSize: '12.5px', textAlign: 'left' },
            title: `Open your ${m.key} matches`,
            onClick: () => { close(); ctx.navigate('matches', { map: m.key }); },
          }),
          h('span', { style: { color: wrColor(m.winrate) } }, pct(m.winrate)),
          // W-L instead of a bare credited-games count (H7) — the number that
          // decides whether a map's winrate here is signal, in the same
          // vocabulary the overall line above already uses.
          h('span', { class: 'u-dim mono', style: { fontSize: '11px', width: '56px', textAlign: 'right' } }, `${m.wins}W ${m.losses}L`),
        ))
      : [h('div', { class: 'hint' }, '—')]),
    section('Recent', d.recent.length
      ? d.recent.map((r) => h('div', {
          class: 'row is-clickable', style: { padding: '6px 0', cursor: 'pointer' },
          // Recent rows used to be inert text (H7) — every other match list in
          // the app opens the detail page on a click; this one just never did.
          on: { click: () => { close(); ctx.navigate('matchDetail', { matchId: r.matchId }); } },
        },
          resultPill(r.result),
          h('span', { class: 'row-main', style: { fontSize: '12.5px' } }, r.map),
          h('span', { class: 'u-dim', style: { fontSize: '11px' } }, `${r.account} · ${new Date(r.timestamp).toLocaleDateString()}`),
        ))
      : [h('div', { class: 'hint' }, '—')]),
  );
}

function section(title: string, rows: Node[]): HTMLElement {
  return h('div', null,
    h('h4', { style: { fontSize: '11px', color: 'var(--muted-2)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '16px 0 6px' } }, title),
    ...rows,
  );
}
