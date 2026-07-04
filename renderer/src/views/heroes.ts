/** Heroes — the exact per-hero table, with a click-through drill-down drawer. */
import { h, render } from '../dom';
import type { HeroDetail, HeroSummary } from '../../../src/shared/contract';
import { bridge } from '../bridge';
import { fmt, pct, roleLabel } from '../format';
import { wrColor } from '../theme';
import { card, resultPill, statBox } from '../components/primitives';
import { dataTable, type Column } from '../components/table';
import { openDrawer } from '../components/overlay';
import { viewHead, type ViewContext } from './view';

export function heroes(ctx: ViewContext): HTMLElement {
  // Column order is the display order; `get` drives sort, `render` is optional display formatting.
  const columns: Array<Column<HeroSummary>> = [
    { key: 'hero', label: 'Hero', get: (r) => r.hero },
    { key: 'role', label: 'Role', get: (r) => r.role ?? '', render: (r) => h('span', { class: 'tag' }, roleLabel(r.role ?? '–')) },
    { key: 'games', label: 'G', get: (r) => r.games },
    { key: 'winrate', label: 'WR', get: (r) => r.winrate, render: (r) => h('span', { style: { color: wrColor(r.winrate) } }, pct(r.winrate)) },
    { key: 'kda', label: 'KDA', get: (r) => r.kda, render: (r) => r.kda.toFixed(1) },
    { key: 'elims', label: 'E/10', get: (r) => r.per10?.eliminations ?? null },
    { key: 'deaths', label: 'D/10', get: (r) => r.per10?.deaths ?? null },
    { key: 'assists', label: 'A/10', get: (r) => r.per10?.assists ?? null },
    { key: 'damage', label: 'DMG/10', get: (r) => r.per10?.damage ?? null, render: (r) => fmt(r.per10?.damage) },
    { key: 'healing', label: 'HEAL/10', get: (r) => r.per10?.healing ?? null, render: (r) => fmt(r.per10?.healing) },
    { key: 'mitigation', label: 'MIT/10', get: (r) => r.per10?.mitigation ?? null, render: (r) => fmt(r.per10?.mitigation) },
  ];

  return h('div', { class: 'view' },
    viewHead('Heroes', 'Exact stats, per 10 minutes · click a hero to drill down'),
    card({ class: 'card--flush', style: { padding: '4px 10px 10px' } },
      dataTable({
        columns,
        rows: ctx.data.heroStats,
        initialSort: { key: 'games', dir: -1 },
        onRowClick: (row) => openHeroDrawer(ctx, row.hero),
      }),
    ),
  );
}

function openHeroDrawer(ctx: ViewContext, hero: string): void {
  openDrawer(() => {
    const body = h('div', null, h('div', { class: 'hint' }, 'Loading…'));
    bridge.heroDetail(hero, ctx.data.filters).then((d) => render(body, heroDetail(d)));
    return body;
  });
}

function heroDetail(d: HeroDetail): HTMLElement {
  const s = d.stats;
  const p = s?.per10;
  return h('div', null,
    h('h3', { style: { fontSize: '18px' } }, d.hero),
    h('p', { class: 'u-muted', style: { fontSize: '12px', margin: '2px 0 14px' } },
      `${d.overall.games} games · ${pct(d.overall.winrate)} winrate · ${d.overall.wins}W ${d.overall.losses}L`),
    s
      ? h('div', { class: 'stat-grid' },
          statBox(s.kda.toFixed(1), 'KDA'),
          statBox(fmt(p?.eliminations), 'Elims/10'),
          statBox(fmt(p?.deaths), 'Deaths/10'),
          statBox(fmt(p?.damage), 'Dmg/10'),
          statBox(fmt(p?.healing), 'Heal/10'),
          statBox(fmt(p?.mitigation), 'Mit/10'),
        )
      : null,
    section('By map', d.byMap.length
      ? d.byMap.map((m) => h('div', { class: 'row', style: { padding: '6px 0' } },
          h('span', { class: 'row-main', style: { fontSize: '12.5px' } }, m.key),
          h('span', { style: { color: wrColor(m.winrate) } }, pct(m.winrate)),
          h('span', { class: 'u-dim', style: { fontSize: '11px', width: '28px', textAlign: 'right' } }, `${m.games}g`),
        ))
      : [h('div', { class: 'hint' }, '—')]),
    section('Recent', d.recent.length
      ? d.recent.map((r) => h('div', { class: 'row', style: { padding: '6px 0' } },
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
