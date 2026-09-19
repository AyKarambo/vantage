/** Maps — by game mode, games-played share, and every map ranked best → worst. */
import { h } from '../dom';
import type { DashboardData, Group, ScoreSplit } from '../../../src/shared/contract';
import { MAP_MIN_GAMES } from '../../../src/core/analytics';
import { makeMapMode, makeMapActive, type MapModeResolver } from '../../../src/core/masterData';
import { fmt, pct, signed } from '../format';
import { wrColor, CATEGORICAL, OTHER_COLOR } from '../theme';
import { donutChart, horizontalBars, type DonutSlice } from '../charts/plots';
import { card, chip, statBar } from '../components/primitives';
import { chartCard } from '../components/chartCard';
import { trendArrow } from '../components/trendArrow';
import { clickableRow } from '../components/clickableRow';
import { prefs } from '../prefs';
import { store } from '../store';
import { viewHead, type ViewContext } from './view';

const TOP_SLICES = 10;
const MIN_GAMES_STEPS = [1, 3, 5] as const;

/** Set by a mode-card click (H4); checked once on the next render, then cleared. */
let scrollToRanking = false;

export function maps(ctx: ViewContext): HTMLElement {
  const d = ctx.data;
  const mapModeOf = makeMapMode(d.masterData.maps);
  const isMapActive = makeMapActive(d.masterData.maps);
  const minMapGames = prefs.get('minMapGames') ?? MAP_MIN_GAMES;
  const modeFilter = prefs.get('mapModeFilter');

  // Cross-links must always land (H4): a mode card, the Overview scatter, a
  // Focus row, the Heroes drawer's By-map rows and the palette's Map entries
  // all point at ONE specific map — never silently hide it because it sits
  // below the persisted floor or outside the persisted mode filter from a
  // previous visit. Scoped to the highlighted map only; every other map still
  // respects the real, persisted floor/filter.
  const highlight = ctx.params.highlight;
  const highlightMap = highlight ? d.byMap.find((m) => m.key === highlight) : undefined;
  const modeBlocksHighlight = !!(highlightMap && modeFilter && mapModeOf(highlightMap.key) !== modeFilter);
  const effectiveMode = modeBlocksHighlight ? undefined : modeFilter;
  const effectiveMinGames = highlightMap && highlightMap.games < minMapGames ? 1 : minMapGames;

  const modeScoped = effectiveMode ? d.byMap.filter((m) => mapModeOf(m.key) === effectiveMode) : d.byMap;
  // The floor filter falls back to EVERY scoped map (including 1-game ones)
  // once nothing meets it, so the subtitle would otherwise keep claiming a
  // floor that isn't actually being applied (F1).
  const meetingFloor = modeScoped.filter((m) => m.games >= effectiveMinGames);
  const floorActive = meetingFloor.length > 0;
  const ranked = (floorActive ? meetingFloor : [...modeScoped]).sort((a, b) => b.winrate - a.winrate);
  const hiddenCount = floorActive ? modeScoped.length - meetingFloor.length : 0;

  const modeChips = h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' } },
    chip('All', !modeFilter, () => { prefs.remove('mapModeFilter'); store.rerender(); }),
    ...d.byMapType.map((g) => chip(g.key, modeFilter === g.key, () => {
      prefs.set('mapModeFilter', g.key);
      store.rerender();
    })),
  );
  const minGamesChips = h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } },
    h('span', { class: 'u-dim', style: { fontSize: '11px' } }, 'min. games'),
    ...MIN_GAMES_STEPS.map((n) => chip(`${n}+`, minMapGames === n, () => {
      prefs.set('minMapGames', n);
      store.rerender();
    })),
  );
  const rankingControls = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-end' } },
    modeChips, minGamesChips,
  );

  const sub = floorActive
    ? `best to worst · ${effectiveMinGames}+ games${hiddenCount > 0 ? ` · ${hiddenCount} low-sample hidden` : ''}`
    : 'best to worst · every map (none have enough plays yet for a floor)';

  const view = h('div', { class: 'view' },
    viewHead('Maps', 'Where the games actually go — by mode, then map by map'),
    h('div', { class: 'grid-3' }, ...d.byMapType.map((g) =>
      modeCard(g, modeFilter === g.key, modeBestWorst(d.byMap, g.key, mapModeOf, minMapGames), d.scoreSplits.byMode[g.key], () => {
        prefs.set('mapModeFilter', g.key);
        scrollToRanking = true;
        store.rerender();
      }))),
    card({ title: 'Maps played', sub: 'share of games in range' },
      donutChart(mapsPlayed(d)),
    ),
    chartCard({
      title: 'Winrate by map',
      sub,
      class: 'maps-ranking-card',
      extraActions: rankingControls,
      columns: [
        { key: 'map', label: 'Map' },
        { key: 'mode', label: 'Mode' },
        { key: 'winrate', label: 'WR', render: (v) => pct(v as number) },
        { key: 'net', label: 'Net', render: (v) => signed(v as number) },
        // Net SR (C2) beside net wins — a 3-loss map that cost −60% is a more
        // urgent fix than one that cost −45%, and the data was already on disk.
        { key: 'sr', label: '±SR', render: (v) => (v == null ? '—' : `${signed(Math.round(v as number))}%`) },
        { key: 'games', label: 'Games' },
        { key: 'rating', label: 'RTG', render: (v) => fmt(v as number | null) }, // matches Heroes' casing (K7)
      ],
      // Raw values, not pre-formatted strings (K1) — `render` above formats
      // them; `get` (chartCard.ts) sorts the same raw number, so WR/Net/Rtg
      // order correctly instead of comparing '100%' < '25%' as strings.
      rows: ranked.map((m) => ({
        map: m.key,
        mode: mapModeOf(m.key),
        winrate: m.winrate,
        net: m.wins - m.losses,
        sr: m.srNet ?? null,
        games: m.games,
        rating: d.performance.byMap.find((b) => b.key === m.key)?.avg ?? null,
      })),
      // Opens in the same best-to-worst order as the chart beside it, rather
      // than chartCard's generic "first column, descending" default.
      initialSort: { key: 'winrate', dir: -1 },
    }, horizontalBars(ranked.map((m) => ({
      label: m.key, winrate: m.winrate, games: m.games,
      meta: mapMeta(m, d, mapModeOf, isMapActive),
    })))),
  );
  // Palette / cross-link entry: scroll to and flash the requested map's bar
  // (or table cell, once the Table toggle is on) — restricted to the
  // ranking's own label/cell elements, never a broad text search of the
  // whole page, which could land on the donut chart's own legend entry for
  // the same map name instead (H4).
  if (highlight) {
    setTimeout(() => {
      const target = [...view.querySelectorAll('.hbar-label, .hbar-row [class*=label], table.data tbody tr td:first-child')]
        .find((el) => el.textContent?.trim() === highlight);
      if (target instanceof HTMLElement) {
        target.scrollIntoView({ block: 'center' });
        target.classList.add('is-highlighted');
        setTimeout(() => target.classList.remove('is-highlighted'), 2400);
      }
    }, 0);
  }
  if (scrollToRanking) {
    scrollToRanking = false;
    setTimeout(() => {
      const target = view.querySelector('.maps-ranking-card');
      if (target instanceof HTMLElement) target.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }, 0);
  }
  return view;
}

/** The mode's own best/worst map by winrate, over the same floor the main ranking applies (falling back to every map in the mode when none meets it). Absent when the mode has no map data at all. */
function modeBestWorst(
  byMap: readonly Group[], mode: string, mapModeOf: MapModeResolver, minGames: number,
): { best?: string; worst?: string } {
  const scoped = byMap.filter((m) => mapModeOf(m.key) === mode);
  const meeting = scoped.filter((m) => m.games >= minGames);
  const pool = meeting.length ? meeting : scoped;
  if (!pool.length) return {};
  const sorted = [...pool].sort((a, b) => b.winrate - a.winrate);
  return { best: sorted[0].key, worst: sorted[sorted.length - 1].key };
}

/**
 * A ranking row's extra small badges (H4) — a trend arrow (Focus's own per-map
 * read, absent for a map with too few games to split into halves), the
 * average self-rating next to it, a ⚑ when an active target is linked to this
 * map, and a dimmed 'out of pool' tag when master data marks it inactive.
 * Renderer-side joins on map key only — no core/contract change.
 */
function mapMeta(m: Group, d: DashboardData, mapModeOf: MapModeResolver, isMapActive: (name: string) => boolean): Node[] {
  const nodes: Node[] = [];
  const entry = d.focusItems.find((e) => e.dimension === 'map' && e.key === m.key);
  const arrow = entry?.trend ? trendArrow(entry.trend) : null;
  if (arrow) nodes.push(arrow);
  const rating = d.performance.byMap.find((b) => b.key === m.key)?.avg;
  if (rating != null) {
    nodes.push(h('span', { class: 'mono u-dim', style: { fontSize: '10px' }, title: 'Average self-rating (RTG)' }, `${Math.round(rating)}`));
  }
  if (entry?.progress) {
    const p = entry.progress;
    const title = p.deltaPts !== undefined
      ? `Tracking "${p.targetName}" — ${signed(p.deltaPts)} pts since you flagged it`
      : `Tracking "${p.targetName}"`;
    nodes.push(h('span', { style: { fontSize: '10.5px' }, title }, '⚑'));
  }
  if (!isMapActive(m.key)) {
    nodes.push(h('span', { class: 'u-dim', style: { fontSize: '9.5px' }, title: 'Not in the current competitive map pool' }, 'out of pool'));
  }
  return nodes;
}

/**
 * Clicking a mode card filters the ranking below to that mode (H4) — the
 * `.card--glow` accent treatment marks the currently-selected one, matching
 * the mode-chip row's own active state (both read/write the same
 * `mapModeFilter` pref).
 */
/** "close 6-4 · decisive 3-9" (H9) — absent for a mode with no classifiable score yet. */
function scoreSplitLine(s: ScoreSplit | undefined): string | null {
  if (!s || s.close.games + s.decisive.games === 0) return null;
  return `close ${s.close.wins}-${s.close.losses} · decisive ${s.decisive.wins}-${s.decisive.losses}`;
}

function modeCard(g: Group, active: boolean, bestWorst: { best?: string; worst?: string }, scoreSplit: ScoreSplit | undefined, onSelect: () => void): HTMLElement {
  // Net SR (C2) beside net wins, when the mode logged any — "+3 net" alone
  // doesn't say whether those three losses cost 5% or 50%.
  const valueText = g.srNet !== undefined ? `${signed(g.wins - g.losses)} · ${signed(Math.round(g.srNet))}%` : signed(g.wins - g.losses);
  const scoreLine = scoreSplitLine(scoreSplit);
  return h('div', {
    class: `card${active ? ' card--glow' : ''}`,
    style: { padding: '13px 15px', cursor: 'pointer' },
    title: `Show ${g.key} maps in the ranking below`,
    ...clickableRow(onSelect),
  },
    h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '9px' } },
      h('div', { style: { fontWeight: '600', fontSize: '13.5px' } }, g.key),
      h('div', { class: 'mono', style: { fontSize: '15px', color: wrColor(g.winrate) } }, pct(g.winrate)),
    ),
    statBar({ label: `${g.games}g`, frac: g.winrate, color: wrColor(g.winrate), valueText }),
    bestWorst.best
      ? h('div', { class: 'hint', style: { marginTop: '8px', fontSize: '10.5px' } },
          bestWorst.best === bestWorst.worst
            ? `Only map so far: ${bestWorst.best}`
            : `Best ${bestWorst.best} · Worst ${bestWorst.worst}`)
      : null,
    scoreLine
      ? h('div', { class: 'hint', style: { marginTop: '4px', fontSize: '10.5px' } }, scoreLine)
      : null,
  );
}

/** Games-played distribution: the top maps individually, the rest as "Other". */
function mapsPlayed(d: DashboardData): DonutSlice[] {
  const sorted = [...d.byMap].sort((a, b) => b.games - a.games);
  const top = sorted.slice(0, TOP_SLICES);
  const rest = sorted.slice(TOP_SLICES);
  const slices: DonutSlice[] = top.map((m, i) => ({ label: m.key, value: m.games, color: CATEGORICAL[i % CATEGORICAL.length] }));
  const other = rest.reduce((sum, m) => sum + m.games, 0);
  if (other > 0) slices.push({ label: `Other (${rest.length} maps)`, value: other, color: OTHER_COLOR });
  return slices;
}
