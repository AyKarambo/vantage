/** Trends — four tabs: Progress (rank, winrate over time, seasons), Maps (game modes, map form, close games), Lineup (role, account, who you queue with) and Patterns (when and how long you play). Objective, tracked facts only (#321): the self-rating card lives on Mental. */
import { h } from '../dom';
import type { Group, MapFormEntry, Momentum, Role, RankSeriesPoint, ScoreSplit, SeasonBreakdown, StreakStats, TrendGroup } from '../../../src/shared/contract';
import { sessionFade, bucketStart, decided } from '../../../src/core/analytics';
import { shortRankLabelOf } from '../../../src/core/rankDisplay';
import { roleLabel, signed } from '../format';
import { horizontalBars, lineChart, rankChart, type WrPoint, type RankSeries } from '../charts/plots';
import { card, segmented, statBox, unlockHint } from '../components/primitives';
import { chartCard } from '../components/chartCard';
import { clickableRow } from '../components/clickableRow';
import { inlineLink } from '../components/inlineLink';
import { PALETTE, wrColor } from '../theme';
import { pct } from '../format';
import { prefs } from '../prefs';
import { store } from '../store';
import { viewHead, type ViewContext } from './view';

type TrendsTab = 'progress' | 'maps' | 'lineup' | 'patterns';

const TABS: Array<{ value: TrendsTab; label: string }> = [
  { value: 'progress', label: 'Progress' },
  { value: 'maps', label: 'Maps' },
  { value: 'lineup', label: 'Lineup' },
  { value: 'patterns', label: 'Patterns' },
];

const TAB_SUBTITLE: Record<TrendsTab, string> = {
  progress: 'Am I climbing? Rank and winrate over time',
  maps: 'Which modes and maps are getting better or worse',
  lineup: 'Role, account and who you queue with',
  patterns: 'When and how long you play — and how close games go',
};

export function trends(ctx: ViewContext): HTMLElement {
  const tab = prefs.get('trendsTab') ?? 'progress';
  const tabs = segmented<TrendsTab>({
    options: TABS,
    value: tab,
    onChange: (v) => { prefs.set('trendsTab', v); store.rerender(); },
  });
  const TAB_BODY: Record<TrendsTab, (c: ViewContext) => Node[]> = { progress, maps, lineup, patterns };
  return h('div', { class: 'view' },
    viewHead('Trends', TAB_SUBTITLE[tab], tabs),
    ...TAB_BODY[tab](ctx),
  );
}

function progress(ctx: ViewContext): Node[] {
  const d = ctx.data;
  const byWeek = d.filters.days === 'all' || (typeof d.filters.days === 'number' && d.filters.days > 90);
  // C7: a day label opens that day's matches — a week label isn't a
  // Matches-recognized day yet, so the click-through stays daily-mode only.
  const openDay = byWeek ? undefined : (label: string) => ctx.navigate('matches', { day: label });
  return [
    rankTrendCard(ctx),
    chartCard({
      title: 'Winrate over time',
      sub: `${byWeek ? 'by week' : 'by day'} · bold line = 7-${byWeek ? 'week' : 'day'} rolling average`,
      columns: [
        { key: 'label', label: byWeek ? 'Week' : 'Day' },
        { key: 'winrate', label: 'WR', render: (v) => pct(v as number) },
        { key: 'games', label: 'Games' },
        { key: 'rolling', label: byWeek ? '7w avg' : '7d avg', render: (v) => pct(v as number) },
      ],
      // Raw winrate (0..1), not a pre-formatted '54%' string (K1) — `render`
      // above formats it, so sorting the WR column compares numbers, not text.
      // Week rows show the week's real Monday date (C5), not the raw ISO
      // week key ("2026-W23") — no year, meaningless out of context.
      rows: d.trend.map((g) => ({ label: trendBucketLabel(g.key, byWeek), winrate: g.winrate, games: g.games, rolling: g.rolling })),
      // Chronological, oldest first — the order the table already opened in.
      initialSort: { key: 'label', dir: 1 },
      ...(openDay ? { onRowClick: (row) => openDay(row.label as string) } : {}),
    },
    h('div', null,
      momentumStrip(d.momentum, byWeek),
      lineChart(d.trend.map(toPoint(byWeek)), openDay, d.masterData.seasons),
      extremesRow(ctx, d.extremes),
    )),
    bySeasonCard(ctx),
  ].filter((n): n is HTMLElement => n !== null);
}

function maps(ctx: ViewContext): Node[] {
  const d = ctx.data;
  return [
    h('div', { class: 'grid-2' },
      card({ title: 'By game mode' }, breakdown(d.byMapType, d.overall.winrate)),
      closeGamesCard(d.scoreSplits),
    ),
    mapFormCard(ctx, d.mapTrends),
  ];
}

function lineup(ctx: ViewContext): Node[] {
  const d = ctx.data;
  return [
    h('div', { class: 'grid-2' },
      card({ title: 'By role' }, breakdown(d.byRole, d.overall.winrate, roleLabel)),
      card({ title: 'By account' }, breakdown(d.byAccount, d.overall.winrate)),
    ),
    queuedWithCard(d.byGroupSize, d.byPartyMember, d.overall.winrate),
  ].filter((n): n is HTMLElement => n !== null);
}

function patterns(ctx: ViewContext): Node[] {
  const d = ctx.data;
  return [
    h('div', { class: 'grid-2' },
      timeOfDayCard(d.timeOfDay, d.overall.winrate),
      sessionPositionCard(d.sessionPosition, d.overall.winrate),
    ),
    gameLengthCard(d.byDuration),
  ].filter((n): n is HTMLElement => n !== null);
}

/**
 * "Which maps am I getting better or worse on?" — each map's winrate over its
 * earlier half of games vs its recent half, split into two lists. Shown as the
 * two winrates themselves ("50% → 85%"), not a bare delta — a "+35" read like
 * rank points. Flat maps are only counted, not listed. A map under
 * {@link MAP_FORM_SOLID_GAMES} renders dimmed: at 3 vs 3 games one result
 * swings a half by 33%. Clicking a row expands that map's own detail below
 * the lists (game-by-game winrate, by season); clicking it again closes it.
 */
/** Games a Map form row needs before it reads as solid rather than faded (5 vs 5). */
const MAP_FORM_SOLID_GAMES = 10;

/** The Map form row currently expanded — view-local, cleared when its map leaves the list. */
let openMapForm: string | undefined;

function mapFormCard(ctx: ViewContext, trends: MapFormEntry[]): HTMLElement {
  const open = trends.find((t) => t.key === openMapForm);
  const better = trends.filter((t) => t.trend === 'improving');
  const worse = trends.filter((t) => t.trend === 'declining').reverse();
  const steady = trends.length - better.length - worse.length;
  const row = (t: MapFormEntry): HTMLElement => {
    const earlierGames = Math.floor(t.games / 2);
    const thin = t.games < MAP_FORM_SOLID_GAMES;
    const isOpen = t === open;
    return h('div', {
      class: `row is-clickable${isOpen ? ' is-active' : ''}`,
      style: { padding: '6px 0', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', opacity: thin ? '0.55' : '1' },
      title: `${t.key}: ${pct(t.earlier)} winrate in your first ${earlierGames} games, ${pct(t.recent)} in your last ${t.games - earlierGames}${thin ? ' — small sample' : ''}. Click for details.`,
      ...clickableRow(() => { openMapForm = isOpen ? undefined : t.key; store.rerender(); }),
    },
      h('span', { class: 'u-dim', style: { fontSize: '10px', width: '8px' } }, isOpen ? '▾' : '▸'),
      h('span', { class: 'row-main', style: { fontSize: '12.5px', flex: '1', fontWeight: isOpen ? '600' : '400' } }, t.key),
      h('span', { class: 'u-dim mono', style: { fontSize: '11px' } }, `${t.games}g`),
      h('span', { class: 'mono', style: { fontSize: '12px', width: '96px', textAlign: 'right' } },
        h('span', { class: 'u-dim' }, `${pct(t.earlier)} → `),
        h('span', { style: { color: t.pts > 0 ? PALETTE.win : PALETTE.loss } }, pct(t.recent)),
      ),
    );
  };
  const column = (title: string, list: MapFormEntry[], empty: string): HTMLElement => h('div', null,
    h('div', { class: 'field-label' }, title),
    list.length
      ? h('div', { class: 'stack', style: { gap: '2px' } }, ...list.map(row))
      : h('div', { class: 'hint' }, empty),
  );
  return card({ title: 'Map form', sub: 'winrate in your earlier games on a map → your recent ones · 6+ games, faded under 10' },
    trends.length
      ? h('div', null,
          h('div', { class: 'grid-2' },
            column('Getting better', better, 'No map is trending up yet.'),
            column('Getting worse', worse, 'No map is trending down.'),
          ),
          steady > 0
            ? h('div', { class: 'hint', style: { marginTop: '10px' } }, `${steady} ${steady === 1 ? 'map is' : 'maps are'} holding steady (winrate moved less than 5%).`)
            : null,
          open ? mapFormDetail(ctx, open) : null,
        )
      : h('div', { class: 'hint' }, 'Needs a map with 6+ games in this range to compare its recent games with earlier ones.'),
  );
}

/** One map's expanded Map form detail: its game-by-game winrate line over the range, then its record per season. */
function mapFormDetail(ctx: ViewContext, t: MapFormEntry): HTMLElement {
  const resultOf = (wr: number): string => (wr === 1 ? 'Win' : wr === 0 ? 'Loss' : 'Draw');
  const points: WrPoint[] = t.timeline.map((p) => ({
    label: p.date, winrate: p.result === 'Win' ? 1 : p.result === 'Loss' ? 0 : 0.5, games: 1, rolling: p.rolling,
  }));
  return h('div', { style: { marginTop: '14px', paddingTop: '12px', borderTop: '1px solid var(--border)' } },
    h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' } },
      h('div', { style: { fontWeight: '600', fontSize: '13.5px' } }, t.key),
      inlineLink('Open on Maps ›', { onClick: () => ctx.navigate('maps', { highlight: t.key }) }),
    ),
    h('div', { class: 'field-label', style: { marginTop: '10px' } }, 'Winrate over time · a dot per game, line = your last 5 games'),
    lineChart(points, undefined, ctx.data.masterData.seasons, (p) => `${p.label} · ${resultOf(p.winrate)} · last 5: ${pct(p.rolling ?? 0)}`),
    t.bySeason.length
      ? h('div', { style: { marginTop: '12px' } },
          h('div', { class: 'field-label' }, 'By season · all your history on this map'),
          seasonRows(ctx, t.bySeason))
      : null,
  );
}

/**
 * Rank over time (C1) — the flagship chart for "am I climbing?", above
 * everything else on Trends. Already scoped to the active role/account
 * filters by `DashboardData.rankTrend` itself (built from the same filtered
 * game set every other Trends card reads), so this just shapes what's
 * already there — no extra client-side narrowing.
 */
function rankTrendCard(ctx: ViewContext): HTMLElement | null {
  const d = ctx.data;
  const entries = Object.entries(d.rankTrend);
  if (!entries.length) return null;
  const multi = entries.length > 1;
  const series: RankSeries[] = entries.map(([key, points]) => {
    const [account, role] = key.split('::');
    return {
      key, label: multi ? `${account} · ${roleLabel(role as Role)}` : roleLabel(role as Role), points,
      marks: d.rankAdjustmentMarks?.[key],
    };
  });

  const dateLabel = (ts: number): string => {
    const dt = new Date(ts);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  };
  const rows = series.flatMap((s) =>
    s.points.map((p: RankSeriesPoint, i: number) => ({
      // Sorts correctly as a plain string (YYYY-MM-DD) — no separate numeric
      // sort key needed, and dataTable requires every sort key to name an
      // actual column.
      label: dateLabel(p.timestamp),
      ...(multi ? { track: s.label } : {}),
      rank: shortRankLabelOf(p.tier, p.division),
      change: i === 0 ? null : p.points - s.points[i - 1].points,
    })));

  // "Net this range" only reads cleanly for one series — with several, a
  // single number would silently pick a winner among tracks the chart itself
  // shows side by side, so the stat box stays reserved for the common case.
  const single = !multi ? series[0] : null;
  const net = single && single.points.length >= 2
    ? single.points[single.points.length - 1].points - single.points[0].points
    : null;

  return chartCard({
    title: 'Rank',
    sub: multi ? 'per account · role, this range' : 'this range',
    columns: [
      { key: 'label', label: 'Date' },
      ...(multi ? [{ key: 'track', label: 'Track' }] : []),
      { key: 'rank', label: 'Rank' },
      { key: 'change', label: '±', render: (v) => (v == null ? '—' : signed(v as number)) },
    ],
    rows,
    initialSort: { key: 'label', dir: 1 },
  },
  h('div', null,
    rankChart(series),
    net !== null
      ? h('div', { style: { marginTop: '10px' } }, statBox(signed(net), 'net this range'))
      : null,
  ));
}

/**
 * Time of day — winrate per local day-part (Morning/Afternoon/Evening/Night),
 * cumulative across everything the active filters keep, shown as the same
 * winrate bars as the other splits (morning → night order, not re-ranked).
 * The best-window callout only fires when the sample is worth reading (≥10
 * decided games in a part, at least 2 parts reaching it) AND that best part is
 * actually a winning one — a 38% bucket topping the pack is still a losing
 * window, not one worth queuing ranked into.
 */
function timeOfDayCard(groups: Group[], overallWinrate: number): HTMLElement {
  const DECIDED_FLOOR = 10;
  const solid = groups.filter((g) => decided(g) >= DECIDED_FLOOR);
  const best = solid.length >= 2 ? [...solid].sort((a, b) => b.winrate - a.winrate)[0] : null;
  // Needs a SECOND day-part to reach the floor too, not just the first — the
  // 2nd-highest decided count is the honest "how close" answer either way (F1).
  const secondBestDecided = groups.map(decided).sort((a, b) => b - a)[1] ?? 0;
  return card({ title: 'Time of day', sub: 'when you actually win' },
    breakdownOrdered(groups, { minGames: BREAKDOWN_MIN_GAMES, marker: overallWinrate }),
    h('div', { style: { marginTop: '10px' } },
      best
        ? h('div', { class: 'hint', style: { lineHeight: '1.5' } },
            best.winrate >= 0.5
              ? h('span', null, 'Your best window is ', h('span', { class: 'is-win' }, best.key.toLowerCase()),
                  ` (${pct(best.winrate)} over ${decided(best)} decided games). Queue ranked when you're sharp, not just when you're free.`)
              : 'No winning window in this range yet — every part of the day is under 50%.')
        : unlockHint(`Needs 2 times of day with ${DECIDED_FLOOR}+ decided games to compare`, [
            { have: secondBestDecided, need: DECIDED_FLOOR, label: 'decided games in your 2nd-best time of day' },
          ])),
  );
}

/** The fatigue curve: winrate by game number within a sitting + the stop-point read. */
function sessionPositionCard(groups: Group[], overallWinrate: number): HTMLElement {
  const FADE_MIN_GAMES = 8;
  const fade = sessionFade(groups);
  // sessionFade returning null means either "not enough data" OR "genuinely
  // no fade" — the old copy always blamed sample size, even once there WAS
  // enough (F1). Games 1-2's own decided count is the actual gate.
  const earlyDecided = groups
    .filter((g) => g.key === '1' || g.key === '2')
    .reduce((n, g) => n + decided(g), 0);
  return card({ title: 'Game # in session', sub: 'the fatigue curve — winrate by position in a sitting' },
    breakdownOrdered(groups.map((g) => ({ ...g, key: `Game ${g.key}` })), { minGames: BREAKDOWN_MIN_GAMES, marker: overallWinrate }),
    h('div', { style: { marginTop: '10px' } },
      fade
        ? h('div', { class: 'hint', style: { lineHeight: '1.5' } },
            h('span', null, 'You fade from ', h('span', { class: 'is-loss' }, `game ${fade.position}`),
              ` on — ${pct(fade.winrate)} vs ${pct(fade.baseline)} in games 1–2. Ending sessions earlier is free rank.`))
        : earlyDecided < FADE_MIN_GAMES
          ? unlockHint(`Needs ${FADE_MIN_GAMES} decided games in games 1–2 of a sitting to read a fatigue curve`, [
              { have: earlyDecided, need: FADE_MIN_GAMES, label: 'decided games in games 1–2' },
            ])
          : h('div', { class: 'hint', style: { lineHeight: '1.5' } }, 'No late-session fade detected — you hold up across a sitting.')),
  );
}

/** Like {@link breakdown} but keeps the caller's order (1 → 6+, morning → night) — never resorted, since a `minGames` floor here would otherwise reshuffle a story order into a ranking. */
function breakdownOrdered(groups: Group[], opts: { minGames?: number; marker?: number } = {}): HTMLElement {
  return horizontalBars(groups.map((g) => ({ label: g.key, winrate: g.winrate, games: g.games })), { compact: true, ...opts });
}

/**
 * A `trend` bucket key as a real calendar date (C5) — the bucket's own day,
 * or a weekly bucket's Monday — instead of the raw ISO week key ("2026-W23")
 * that carries no year and means nothing without the row it came from.
 */
const trendBucketLabel = (key: string, byWeek: boolean): string =>
  byWeek ? new Date(bucketStart(key, 'week')).toISOString().slice(0, 10) : key;

const toPoint = (byWeek: boolean) => (g: TrendGroup): WrPoint =>
  ({ label: trendBucketLabel(g.key, byWeek), winrate: g.winrate, games: g.games, rolling: g.rolling });

/**
 * The momentum read (C6): the trailing window vs. the one before it, in
 * numbers — Trends, the screen named after the trend, otherwise made you
 * eyeball the bold line to answer "am I actually improving?". Absent below
 * the sample floor (`d.momentum` is null) rather than a misleading "–" triple.
 */
function momentumStrip(m: Momentum | null, byWeek: boolean): HTMLElement | null {
  if (!m) return null;
  const span = byWeek ? m.days / 7 : m.days;
  const unit = byWeek ? (span === 1 ? 'week' : 'weeks') : (span === 1 ? 'day' : 'days');
  const deltaColor = m.deltaPts > 0 ? PALETTE.win : m.deltaPts < 0 ? PALETTE.loss : PALETTE.muted;
  return h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginBottom: '10px' } },
    statBox(pct(m.recent.winrate), `last ${span} ${unit} · ${m.recent.games}g`),
    statBox(pct(m.previous.winrate), `previous ${span} ${unit} · ${m.previous.games}g`),
    statBox(h('span', { style: { color: deltaColor } }, `${signed(m.deltaPts)} pts`), 'change'),
  );
}

/**
 * "Best / worst day" (C7) — the single calendar day, anywhere in range, with
 * the highest/lowest net wins − losses. Each box opens that day's matches,
 * same destination a chart-point click already goes to. Omitted entirely
 * with no games in range (streakStats returns no days).
 */
function extremesRow(ctx: ViewContext, extremes: StreakStats): HTMLElement | null {
  if (!extremes.bestDay && !extremes.worstDay) return null;
  const dayBox = (day: StreakStats['bestDay'], label: string): HTMLElement | null => {
    if (!day) return null;
    return h('div', {
      class: 'stat-box', style: { cursor: 'pointer' },
      title: `Open ${day.date}'s matches`,
      ...clickableRow(() => ctx.navigate('matches', { day: day.date })),
    },
      h('div', { class: 'stat-box-value' }, `${signed(day.net)} (${day.wins}W ${day.losses}L)`),
      h('div', { class: 'stat-box-label' }, label),
    );
  };
  return h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px', marginTop: '10px' } },
    dayBox(extremes.bestDay, 'best day'),
    dayBox(extremes.worstDay, 'worst day'),
  );
}

/**
 * "How did each season go" (C5), answered as one card instead of ten filter
 * changes and ten memorised numbers — `DashboardData.bySeason` already
 * covers the player's whole account/role-scoped history regardless of the
 * active date filter, so this can jump straight to any season. Shown once
 * there's more than one season with games to actually compare.
 */
function bySeasonCard(ctx: ViewContext): HTMLElement | null {
  const seasons = ctx.data.bySeason.filter((s) => s.games > 0);
  if (seasons.length < 2) return null;
  return card({ title: 'By season', sub: 'across all your history · click a season to jump to it' },
    seasonRows(ctx, seasons),
  );
}

/** One row per season (label, ±SR, W-L, winrate); a click jumps the filter to that season. Shared by By season and the Map form detail. */
function seasonRows(ctx: ViewContext, seasons: SeasonBreakdown[]): HTMLElement {
  return h('div', { class: 'stack', style: { gap: '2px', marginTop: '4px' } },
    ...seasons.map((s) => h('div', {
      class: 'row is-clickable', style: { padding: '6px 0', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px' },
      ...clickableRow(() => ctx.setFilter({ days: { season: s.id } })),
    },
      h('span', { class: 'row-main', style: { fontSize: '12.5px', flex: '1' } }, s.label),
      s.srNet !== undefined
        ? h('span', { class: 'u-dim mono', style: { fontSize: '11px' } }, `${signed(Math.round(s.srNet))}%`)
        : null,
      h('span', { class: 'u-dim mono', style: { fontSize: '11px' } }, `${s.wins}W ${s.losses}L`),
      h('span', { class: 'mono', style: { fontSize: '12.5px', color: wrColor(s.winrate), width: '42px', textAlign: 'right' } }, pct(s.winrate)),
    )),
  );
}

/** Games a breakdown row needs before it's ranked as trustworthy (F6) — below it, the row still shows (dimmed, `horizontalBars`' `minGames`) rather than vanishing, just sorted after the qualified ones so a small-sample fluke can't rank #1. */
const BREAKDOWN_MIN_GAMES = 10;

/**
 * A compact winrate-bar list for a categorical split — one row per group,
 * ranked best → worst within two tiers: rows with `≥ BREAKDOWN_MIN_GAMES`
 * first (sorted by winrate, as before), then thinner rows after (also
 * winrate-sorted among themselves) — a 2-game 100% row used to be able to
 * rank #1 ahead of a 40-game 55% one (F6). Uses the same responsive
 * horizontal bars as the Maps view so the breakdowns read cleanly whether
 * there's one row or many, with a reference tick at the player's own overall
 * winrate for this range.
 */
function breakdown(groups: Group[], overallWinrate: number, label: (key: string) => string = (k) => k): HTMLElement {
  const byWinrate = (a: Group, b: Group): number => b.winrate - a.winrate;
  const qualified = groups.filter((g) => g.games >= BREAKDOWN_MIN_GAMES).sort(byWinrate);
  const thin = groups.filter((g) => g.games < BREAKDOWN_MIN_GAMES).sort(byWinrate);
  const data = [...qualified, ...thin].map((g) => ({ label: label(g.key), winrate: g.winrate, games: g.games }));
  return horizontalBars(data, { compact: true, minGames: BREAKDOWN_MIN_GAMES, marker: overallWinrate });
}

/** Pull `keys` out of `groups` in that fixed order (not winrate-sorted) — a story order, not a ranking. */
function inOrder(groups: Group[], keys: string[]): Group[] {
  return keys.map((k) => groups.find((g) => g.key === k)).filter((g): g is Group => g != null);
}

/**
 * "Do I win more solo or with a group, and with whom?" (#355) — Solo → Duo →
 * Trio+ in the order a player reasons about it, then one row per teammate
 * recorded in a party. Only shown once at least one grouped game exists:
 * an all-Solo history has nothing to compare.
 */
function queuedWithCard(sizes: Group[], members: Group[], overallWinrate: number): HTMLElement | null {
  const ordered = inOrder(sizes, ['Solo', 'Duo', 'Trio+']);
  if (!ordered.some((g) => g.key !== 'Solo')) return null;
  return card({ title: 'Solo vs grouped', sub: 'and who you queue with' },
    breakdownOrdered(ordered, { minGames: BREAKDOWN_MIN_GAMES, marker: overallWinrate }),
    members.length
      ? h('div', { style: { marginTop: '12px' } },
          h('div', { class: 'field-label' }, 'Queued with'),
          // Wider name column, BattleTag number dropped — 76px cut every name
          // to "Lampenlich…"; the full tag stays in the row's tooltip.
          h('div', { class: 'queued-with' }, breakdown(members.slice(0, 8), overallWinrate, (k) => k.split('#')[0])))
      : null,
  );
}

/**
 * "Am I losing close games or getting rolled?" (H9) — a clutch/mental read
 * distinct from fundamentals, from data (`finalScore`) that was already on
 * disk. Scoped to round-tally modes only (Control, Clash, Flashpoint) —
 * Escort/Hybrid/Push report a payload distance, not rounds, so a score there
 * can't be classified and is left out rather than guessed at.
 */
function closeGamesCard(s: ScoreSplit): HTMLElement | null {
  const total = s.close.games + s.decisive.games;
  if (!total) return null;
  return card({ title: 'Close games', sub: 'Control, Clash & Flashpoint only · round margin' },
    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' } },
      statBox(pct(s.close.winrate), `close (1 round) · ${s.close.games}g`),
      statBox(pct(s.decisive.winrate), `decisive (2+ rounds) · ${s.decisive.games}g`),
    ),
    s.close.games >= 5 && s.close.winrate < s.decisive.winrate
      ? h('div', { class: 'hint', style: { marginTop: '10px', lineHeight: '1.5' } },
          `You win decisive games more than close ones — that points at execution under pressure, `
          + 'not fundamentals. See Mental for tilt and session patterns.')
      : null,
  );
}

/**
 * "Am I better in short games or long ones?" (H9) — game length was stored
 * (`durationMinutes`) but never grouped. Short → Typical → Long, tercile
 * boundaries computed per mode so a Push-heavy sample doesn't skew the buckets.
 */
function gameLengthCard(groups: Group[]): HTMLElement | null {
  const ordered = inOrder(groups, ['Short', 'Typical', 'Long']);
  if (!ordered.length) return null;
  return card({ title: 'Game length', sub: 'short / typical / long, relative to each mode' },
    breakdownOrdered(ordered));
}
