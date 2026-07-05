/** Home / Overview — priority maps at a glance, the way you locked it in. */
import { h } from '../dom';
import type { DashboardData, Group, SessionRecap } from '../../../src/shared/contract';
import { mapMode } from '../../../src/core/maps';
import { dateLong, greeting, int, pct, rankLabel, signed, streakText } from '../format';
import { PALETTE, wrColor, wrHsl, CATEGORICAL } from '../theme';
import { scatterChart, type ScatterPoint } from '../charts/plots';
import { button, card, kpiCard, statBar, statBox } from '../components/primitives';
import { prefs } from '../prefs';
import { viewHead, shorten, type ViewContext } from './view';

export function overview(ctx: ViewContext): HTMLElement {
  const d = ctx.data;
  const wr = d.overall.winrate;

  const head = viewHead(
    `${greeting()}, ${d.greetingName}`,
    `${dateLong()} · you're ${pct(wr)} — here's where the points are hiding`,
    button('Log match', { variant: 'primary', onClick: ctx.openLogMatch }),
  );

  return h('div', { class: 'view' },
    head,
    hiddenHistoryBanner(ctx),
    recapCard(d),
    kpiRow(d),
    scatterCard(ctx),
    bottomRow(ctx),
  );
}

/**
 * Safety net for a just-imported (or otherwise old) history: when the active
 * date window hides *every* game — filtered games 0 but all-time games > 0 —
 * the Overview would otherwise render a fully blank dashboard that reads as
 * "the import did nothing". Surface the count and a one-click way to see it.
 */
function hiddenHistoryBanner(ctx: ViewContext): HTMLElement | null {
  const d = ctx.data;
  if (d.overall.games > 0 || d.totalGamesAllTime === 0 || d.filters.days === 'all') return null;
  const n = d.totalGamesAllTime;
  return card({ variant: 'glow', title: 'Your history is outside this date range' },
    h('div', { class: 'hint', style: { lineHeight: '1.55', marginBottom: '12px' } },
      `You have ${int(n)} game${n === 1 ? '' : 's'} in your history, but none in the selected range — imported matches often carry older dates. View your full history to see them.`),
    button(`View all time (${int(n)} games)`, { variant: 'primary', onClick: () => ctx.setFilter({ days: 'all' }) }),
  );
}

/** Yesterday's coach recap — shown once per day, dismissible. */
function recapCard(d: DashboardData): HTMLElement | null {
  const r = d.recap;
  if (!r || prefs.get('recapShown') === r.date) return null;

  const host = h('div');
  const dismiss = (): void => {
    prefs.set('recapShown', r.date);
    host.remove();
  };
  host.append(card({
    variant: 'glow',
    title: 'Yesterday’s session',
    sub: recapLine(r),
    actions: button('✕', { variant: 'ghost', title: 'Dismiss (shows once per day)', onClick: dismiss }),
  },
    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginTop: '4px' } },
      statBox(h('span', { class: r.net >= 0 ? 'is-win' : 'is-loss' }, `${r.wins}–${r.losses}`), `${signed(r.net)} net`),
      statBox(pct(r.winrate), 'winrate'),
      r.bestMap ? statBox(shorten(r.bestMap), 'best map') : statBox('—', 'best map'),
      r.targetHitRate !== undefined ? statBox(pct(r.targetHitRate), 'targets hit') : statBox('—', 'targets hit'),
    ),
  ));
  return host;
}

function recapLine(r: SessionRecap): string {
  const bits = [`${r.games} game${r.games === 1 ? '' : 's'}`];
  if (r.worstMap) bits.push(`toughest: ${r.worstMap}`);
  if (r.flags.tilt) bits.push(`tilt flagged ×${r.flags.tilt}`);
  return bits.join(' · ');
}

function kpiRow(d: DashboardData): HTMLElement {
  const trendDelta = wrTrendDelta(d.trend, d.overall.winrate);
  return h('div', { class: 'kpi-row' },
    kpiCard({
      label: 'Winrate',
      value: d.overall.games ? pct(d.overall.winrate) : '–',
      delta: trendDelta != null
        ? { text: `${trendDelta >= 0 ? '▴' : '▾'} ${Math.abs(trendDelta).toFixed(1)} recent`, dir: trendDelta >= 0 ? 'up' : 'down' }
        : undefined,
    }),
    kpiCard({ label: 'Games', value: int(d.overall.games), delta: { text: `${d.overall.wins}W · ${d.overall.losses}L` } }),
    rankKpi(d),
    kpiCard({
      label: 'Streak',
      value: streakText(d.streak),
      accent: true,
      delta: { text: d.streak.type === 'W' ? 'ride it' : d.streak.type === 'L' ? 'reset it' : '—' },
    }),
  );
}

/**
 * Rank KPI — the user's real anchored rank when set, else the winrate heuristic.
 * The anchored rank always wins, so setting a rank in Settings is reflected here.
 */
function rankKpi(d: DashboardData): HTMLElement {
  const r = d.primaryRank;
  if (r) {
    return kpiCard({
      label: 'Rank',
      value: rankLabel(r.tier, r.division),
      delta: {
        text: r.needsReanchor ? 'set % after demotion' : `${Math.round(r.progressPct)}% in division`,
        dir: 'up',
      },
    });
  }
  return kpiCard({
    label: 'Rank',
    value: `${d.progression.tier} ${d.progression.division}`,
    delta: {
      text: `${d.progression.delta >= 0 ? '▴' : '▾'} ${Math.round(d.progression.progressPct)}% in division`,
      dir: d.progression.delta >= 0 ? 'up' : 'down',
    },
  });
}

function scatterCard(ctx: ViewContext): HTMLElement {
  const d = ctx.data;
  const points = toScatter(d.byMap);
  const focus = d.focusMaps.filter((f) => f.net > 0).slice(0, 3);

  const callouts = h('div', { class: 'scatter-callouts' },
    h('div', { style: { fontSize: '12px', fontWeight: '600', color: '#c98079', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '2px' } }, 'Top priority'),
    ...(focus.length
      ? focus.map((m) => h('div', { class: 'row' },
          h('span', { class: 'dot', style: { background: wrHsl(m.winrate) } }),
          h('div', { class: 'row-main' },
            h('div', { class: 'row-name' }, m.key),
            h('div', { class: 'row-meta' }, `${m.games} games · net ${signed(m.wins - m.losses)}`),
          ),
          h('span', { class: 'mono', style: { fontSize: '14px', color: wrColor(m.winrate) } }, pct(m.winrate)),
        ))
      : [h('div', { class: 'empty empty--good', style: { paddingTop: '10px' } }, 'No net-losing maps — clean season. 🎯')]),
    h('div', { style: { marginTop: 'auto', paddingTop: '12px' } },
      h('div', { class: 'hint', style: { lineHeight: '1.55' } }, 'These are dragging your season. Queue them in practice before ranked and review one replay each.'),
      h('div', { style: { marginTop: '10px' } },
        button('Build a focus routine →', { variant: 'soft', class: 'btn--block', onClick: () => ctx.navigate('focus') }),
      ),
    ),
  );

  return card(
    { title: 'Every map · winrate × volume', sub: 'Below the line = losing. Further right = you play it a lot. Fix the bottom-right first.', style: { flex: '1' } },
    h('div', { class: 'overview-scatter' },
      h('div', { class: 'scatter-plot' }, scatterChart(points), scatterLegend(points)),
      callouts,
    ),
  );
}

/** Legend of the maps in the scatter — each swatch matches its dot colour; the
 *  full map name is on hover (both here and on the dot). */
function scatterLegend(points: ScatterPoint[]): HTMLElement {
  return h('div', { class: 'chart-legend' },
    ...points.map((p) =>
      h('span', { class: 'legend-item', title: p.name },
        h('span', { class: 'legend-dot', style: { background: p.color } }), p.short),
    ),
  );
}

function bottomRow(ctx: ViewContext): HTMLElement {
  const d = ctx.data;
  const queue = d.focusMaps.filter((f) => f.net > 0).slice(0, 4);

  const focusQueue = card({ title: 'Focus queue', style: { flex: '1.3' } },
    ...(queue.length
      ? queue.map((m) => h('div', { class: 'row', style: { padding: '6px 0' } },
          h('span', { class: 'dot', style: { background: wrHsl(m.winrate) } }),
          h('div', { class: 'row-main', style: { fontSize: '12.5px' } }, m.key),
          h('span', { class: 'mono', style: { fontSize: '12px', color: wrColor(m.winrate) } }, pct(m.winrate)),
          h('button', { class: 'btn btn--ghost', style: { padding: '3px 8px', fontSize: '10.5px' }, on: { click: () => ctx.navigate('focus') } }, '▶ queue'),
        ))
      : [h('div', { class: 'empty empty--good' }, 'Nothing losing right now.')]),
  );

  const m = d.mental;
  const r = d.breakReminder;
  const mental = card({ title: 'Mental', style: { flex: '1' } },
    h('div', { class: 'stack', style: { gap: '9px' } },
      statBar({ label: 'Calm', frac: m.calm / 100, color: PALETTE.win, valueText: String(m.calm) }),
      statBar({ label: 'Tilted', frac: m.tilted / 100, color: PALETTE.loss, valueText: String(m.tilted) }),
    ),
    h('div', { class: 'hint', style: { marginTop: '11px', lineHeight: '1.45' } },
      r.enabled
        ? h('span', null, 'Break reminder is ', h('span', { class: 'is-win' }, 'on'), ` after ${r.afterLosses} losses.`)
        : h('span', { class: 'u-dim' }, 'Break reminder is off — turn it on in Mental.')),
  );

  return h('div', { class: 'overview-bottom' }, focusQueue, mental, readinessCard(ctx));
}

const READINESS_META: Record<string, { label: string; color: string }> = {
  fresh: { label: 'Fresh', color: PALETTE.win },
  steady: { label: 'Steady', color: PALETTE.win },
  loaded: { label: 'Loaded', color: PALETTE.mid },
  'in-the-hole': { label: 'In the hole', color: PALETTE.loss },
  recovering: { label: 'Recovering', color: PALETTE.accentBright },
  'insufficient-data': { label: 'Not enough data', color: PALETTE.muted },
};

/** Compact readiness teaser — only when the feature is on; deep-links to the screen. */
function readinessCard(ctx: ViewContext): HTMLElement | null {
  const d = ctx.data;
  if (!d.readinessSettings.enabled) return null;
  const r = d.readiness;
  const meta = READINESS_META[r.band] ?? READINESS_META['insufficient-data'];
  const showScore = r.score !== null && r.confidence !== 'low';
  return card({ title: 'Readiness', style: { flex: '1' } },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '9px', marginTop: '2px' } },
      h('span', { style: { width: '11px', height: '11px', borderRadius: '50%', background: meta.color, flex: '0 0 auto' } }),
      h('span', { style: { fontSize: '15px', fontWeight: '600' } }, meta.label),
      showScore ? h('span', { class: 'mono', style: { marginLeft: 'auto', fontSize: '15px', color: meta.color } }, String(r.score)) : null,
    ),
    h('div', { class: 'hint', style: { marginTop: '9px', lineHeight: '1.45' } }, r.recommendationText || r.headline),
    h('div', { style: { marginTop: '10px' } },
      button('Open readiness →', { variant: 'soft', class: 'btn--block', onClick: () => ctx.navigate('readiness') }),
    ),
  );
}

// --- helpers ----------------------------------------------------------------

function toScatter(byMap: Group[]): ScatterPoint[] {
  // Most-played first, so the legend leads with the relevant maps and each map
  // gets a stable colour shared by its dot and its legend swatch.
  return [...byMap]
    .sort((a, b) => b.games - a.games)
    .map((m, i) => {
      const net = m.losses - m.wins;
      return {
        name: m.key,
        short: shorten(m.key),
        mode: mapMode(m.key),
        color: CATEGORICAL[i % CATEGORICAL.length],
        winrate: m.winrate,
        volume: m.games,
        net,
        focus: net >= 3,
      };
    });
}

/**
 * Recent form vs the range average, in winrate points. Uses the mean of the last
 * few buckets rather than a single bucket, so it doesn't swing on one good day.
 */
function wrTrendDelta(trend: Group[], baseline: number): number | null {
  if (trend.length < 3) return null;
  const recent = trend.slice(-5);
  const mean = recent.reduce((sum, b) => sum + b.winrate, 0) / recent.length;
  return (mean - baseline) * 100;
}
