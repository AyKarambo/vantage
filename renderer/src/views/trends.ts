/** Trends — winrate over time, splits by role/mode/account, and when you play. */
import { h } from '../dom';
import type { Group, Momentum, PerformanceStats, Role, RankSeriesPoint, ScoreSplit, StreakStats, TrendGroup } from '../../../src/shared/contract';
import { sessionFade, bucketStart } from '../../../src/core/analytics';
import { shortRankLabelOf } from '../../../src/core/rankDisplay';
import { roleLabel, signed } from '../format';
import { horizontalBars, lineChart, ratingChart, rankChart, type WrPoint, type RankSeries } from '../charts/plots';
import { card, emptyState, statBox, unlockHint } from '../components/primitives';
import { chartCard } from '../components/chartCard';
import { clickableRow } from '../components/clickableRow';
import { PALETTE, wrColor } from '../theme';
import { pct } from '../format';
import { viewHead, type ViewContext } from './view';

export function trends(ctx: ViewContext): HTMLElement {
  const d = ctx.data;
  const byWeek = d.filters.days === 'all' || (typeof d.filters.days === 'number' && d.filters.days > 90);
  // C7: a day label opens that day's matches — a week label isn't a
  // Matches-recognized day yet, so the click-through stays daily-mode only.
  const openDay = byWeek ? undefined : (label: string) => ctx.navigate('matches', { day: label });
  return h('div', { class: 'view' },
    viewHead('Trends', 'Momentum over time and where your winrate concentrates'),
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
    h('div', { class: 'grid-3' },
      card({ title: 'By role' }, breakdown(d.byRole, roleLabel)),
      card({ title: 'By game mode' }, breakdown(d.byMapType)),
      card({ title: 'By account' }, breakdown(d.byAccount)),
    ),
    h('div', { class: 'grid-2' },
      soloVsGroupedCard(d.byGroupSize),
      closeGamesCard(d.scoreSplits),
    ),
    bySeasonCard(ctx),
    h('div', { class: 'grid-3' },
      timeOfDayCard(d.timeOfDay),
      sessionPositionCard(d.sessionPosition),
      gameLengthCard(d.byDuration),
    ),
    performanceCard(ctx, d.performance),
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
    return { key, label: multi ? `${account} · ${roleLabel(role as Role)}` : roleLabel(role as Role), points };
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

/** Best/worst window callout only when the sample is worth reading (≥10 decided games)
 *  AND that best bucket is actually a winning one — a 38% bucket topping the
 *  pack is still a losing window, not one worth queuing ranked into. */
function timeOfDayCard(groups: Group[]): HTMLElement {
  const DECIDED_FLOOR = 10;
  const solid = groups.filter((g) => g.wins + g.losses >= DECIDED_FLOOR);
  const best = solid.length >= 2 ? [...solid].sort((a, b) => b.winrate - a.winrate)[0] : null;
  // Needs a SECOND day-part to reach the floor too, not just the first — the
  // 2nd-highest decided count is the honest "how close" answer either way,
  // whether 0 or 1 day-parts currently qualify (F1).
  const secondBestDecided = [...groups].map((g) => g.wins + g.losses).sort((a, b) => b - a)[1] ?? 0;
  return card({ title: 'Time of day', sub: 'when you actually win' },
    breakdownOrdered(groups),
    h('div', { style: { marginTop: '10px' } },
      best
        ? h('div', { class: 'hint', style: { lineHeight: '1.5' } },
            best.winrate >= 0.5
              ? h('span', null, 'Your best window is ', h('span', { class: 'is-win' }, best.key.toLowerCase()),
                  ` (${pct(best.winrate)} over ${best.wins + best.losses} decided games). Queue ranked when you're sharp, not just when you're free.`)
              : 'No winning window in this range yet — every day-part is under 50%.')
        : unlockHint(`Needs 2 day-parts with ${DECIDED_FLOOR}+ decided games to compare`, [
            { have: secondBestDecided, need: DECIDED_FLOOR, label: 'decided games in your 2nd-best window' },
          ])),
  );
}

/** The fatigue curve: winrate by game number within a sitting + the stop-point read. */
function sessionPositionCard(groups: Group[]): HTMLElement {
  const FADE_MIN_GAMES = 8;
  const fade = sessionFade(groups);
  // sessionFade returning null means either "not enough data" OR "genuinely
  // no fade" — the old copy always blamed sample size, even once there WAS
  // enough (F1). Games 1-2's own decided count is the actual gate.
  const earlyDecided = groups
    .filter((g) => g.key === '1' || g.key === '2')
    .reduce((n, g) => n + g.wins + g.losses, 0);
  return card({ title: 'Game # in session', sub: 'the fatigue curve — winrate by position in a sitting' },
    breakdownOrdered(groups.map((g) => ({ ...g, key: `Game ${g.key}` }))),
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

/** Like {@link breakdown} but keeps the caller's order (1 → 6+, morning → night). */
function breakdownOrdered(groups: Group[]): HTMLElement {
  return horizontalBars(groups.map((g) => ({ label: g.key, winrate: g.winrate, games: g.games })), { compact: true });
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
 * Self-rated performance over time (issue #44): the rating trend with a rolling
 * average, plus the "does your self-read track results?" win/loss split.
 */
function performanceCard(ctx: ViewContext, p: PerformanceStats): HTMLElement {
  if (p.ratedGames === 0) {
    return card({ title: 'Your self-rating', sub: 'rate matches when logging or reviewing to unlock this' },
      emptyState('No rated games in this range yet — the 0–100 performance slider lives on Log Match and Review.'));
  }
  const gap = p.winAvg !== null && p.lossAvg !== null ? Math.round((p.winAvg - p.lossAvg) * 10) / 10 : null;
  // C7: always daily today (unlike the winrate chart, this trend has no
  // weekly-bucket mode yet), so the day click-through is unconditional.
  const openDay = (label: string): void => ctx.navigate('matches', { day: label });
  return chartCard({
    title: 'Your self-rating',
    sub: `0–100 per match · ${p.ratedGames} rated game${p.ratedGames === 1 ? '' : 's'} · line = 7-day rolling average`,
    columns: [
      { key: 'label', label: 'Day' },
      // Raw average (can carry decimals) — render rounds for display, same as
      // the table used to do implicitly for every numeric column before K1.
      { key: 'avg', label: 'Avg rating', render: (v) => (v == null ? '–' : String(Math.round(v as number))) },
      { key: 'games', label: 'Rated' },
      { key: 'rolling', label: '7d avg', render: (v) => (v == null ? '–' : String(Math.round(v as number))) },
    ],
    rows: p.trend.map((t) => ({ label: t.date, avg: t.avg, games: t.games, rolling: t.rolling })),
    initialSort: { key: 'label', dir: 1 },
    onRowClick: (row) => openDay(row.label as string),
  },
  h('div', null,
    ratingChart(p.trend.map((t) => ({ label: t.date, rating: t.avg, games: t.games, rolling: t.rolling })), openDay),
    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginTop: '10px' } },
      statBox(p.winAvg !== null ? String(p.winAvg) : '–', 'avg rating on wins'),
      statBox(p.lossAvg !== null ? String(p.lossAvg) : '–', 'avg rating on losses'),
      statBox(gap !== null ? (gap > 0 ? `+${gap}` : String(gap)) : '–', 'win − loss gap'),
    ),
    gap !== null
      ? h('div', { class: 'hint', style: { marginTop: '8px', lineHeight: '1.5' } },
          gap >= 15
            ? 'Your self-read tracks results closely — you rate wins much higher than losses. Worth asking: are you grading the outcome instead of your play?'
            : gap <= 2
              ? 'You rate wins and losses about the same — a self-read that ignores the scoreboard is exactly what review is for.'
              : 'A modest win/loss gap — your self-rating mostly reflects your play, with a little scoreboard bleed.')
      : null,
  ));
}

/**
 * A compact winrate-bar list for a categorical split — one row per group, ranked
 * best → worst. Uses the same responsive horizontal bars as the Maps view so the
 * breakdowns read cleanly whether there's one row or many (vertical SVG bars
 * ballooned when a card had only a single category).
 */
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
    h('div', { class: 'stack', style: { gap: '2px', marginTop: '4px' } },
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
    ),
  );
}

function breakdown(groups: Group[], label: (key: string) => string = (k) => k): HTMLElement {
  const data = [...groups]
    .sort((a, b) => b.winrate - a.winrate)
    .map((g) => ({ label: label(g.key), winrate: g.winrate, games: g.games }));
  return horizontalBars(data, { compact: true });
}

/** Pull `keys` out of `groups` in that fixed order (not winrate-sorted) — a story order, not a ranking. */
function inOrder(groups: Group[], keys: string[]): Group[] {
  return keys.map((k) => groups.find((g) => g.key === k)).filter((g): g is Group => g != null);
}

/**
 * "Do I win more solo or with a group?" (H9) — party size was captured by GEP
 * and stored, but never surfaced anywhere. Solo → Duo → Trio+ → Unknown, the
 * order a player reasons about it in, not a winrate ranking.
 */
function soloVsGroupedCard(groups: Group[]): HTMLElement | null {
  const ordered = inOrder(groups, ['Solo', 'Duo', 'Trio+', 'Unknown']);
  if (!ordered.length) return null;
  return card({ title: 'Solo vs grouped' }, breakdownOrdered(ordered));
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
