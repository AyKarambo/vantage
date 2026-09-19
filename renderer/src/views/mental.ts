/** Mental — the manual (◎) side: tilt, comms, and what it costs your winrate. */
import { h } from '../dom';
import type { CheckInMood, MatchFlagKey, RatedSide, TiltBucket, WinrateSide } from '../../../src/shared/contract';
import { CHECK_IN_LABELS } from '../../../src/shared/contract';
import { COST_MIN_SAMPLE, tiltTrendDirection, type TiltTrendDirection } from '../../../src/core/mentalAnalytics';
import { confidenceTier } from '../../../src/core/confidence';
import { pct } from '../format';
import { PALETTE } from '../theme';
import { lineChart, type WrPoint } from '../charts/plots';
import { badge, card, statBar, statBox, unlockHint } from '../components/primitives';
import { chartCard } from '../components/chartCard';
import { inlineLink } from '../components/inlineLink';
import { stopRuleLine } from '../components/stopRuleLine';
import { breakReminderEditor } from '../components/breakReminderEditor';
import { viewHead, type ViewContext } from './view';

/** Human labels matching the drill-down chip on Matches. */
const FLAG_LABELS: Record<MatchFlagKey, string> = {
  tilt: 'tilt',
  toxicMates: 'toxic mates',
  leaver: 'leaver',
  positiveComms: 'positive comms',
  abusive: 'abusive comms',
};

export function mental(ctx: ViewContext): HTMLElement {
  const m = ctx.data.mental;

  return h('div', { class: 'view' },
    viewHead('Mental', 'The signals the game never reports — logged by you, ◎ manual'),
    // Pair the two compact cards (State, Trends) in the top row and the two
    // taller ones (costs, session) below, each at its natural height
    // (align-items: start) — so no card is stretched to a row's height and left
    // half-empty.
    h('div', { class: 'grid-2', style: { alignItems: 'start' } },
      card({ title: 'State', sub: 'two independent 0–100 reads, not a split', actions: badge('◎ manual', 'manual') },
        h('div', { class: 'stack', style: { gap: '11px', marginTop: '4px' } },
          statBar({
            label: 'Calm', frac: m.calm / 100, color: PALETTE.win, valueText: `${m.calm}%`,
            title: 'Calm — blends not-tilted games with positive-comms games',
          }),
          statBar({
            label: 'Tilted', frac: m.tilted / 100, color: PALETTE.loss,
            valueText: inlineLink(`${m.tilted}%`, {
              title: `Tilted — ${m.flags.tilt} of ${ctx.data.overall.games} games flagged tilted`,
              onClick: () => ctx.navigate('matches', { flag: 'tilt' }),
            }),
          }),
        ),
        breakReminderEditor(ctx),
      ),
      trendsCard(ctx),
      costsCard(ctx),
      sessionCard(ctx),
    ),
    card({ title: 'Flags this range', sub: 'how often each came up' },
      h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '10px' } },
        flagBox(ctx, m.flags.tilt, 'Tilt', 'tilt'),
        flagBox(ctx, m.flags.toxicMates, 'Toxic mates', 'toxicMates'),
        // The my-team/enemy split is aggregated separately on the payload; the
        // drill-down stays combined ('leaver') until MatchFlagKey is widened
        // (explicitly deferred — see spec #76).
        flagBox(ctx, m.flags.leaverMyTeam, 'Leaver — my team', 'leaver', 'is-loss'),
        flagBox(ctx, m.flags.leaverEnemyTeam, 'Leaver — enemy', 'leaver', 'is-win'),
        flagBox(ctx, m.flags.positiveComms, 'Positive comms', 'positiveComms', 'is-accent'),
        flagBox(ctx, m.flags.abusive, 'Abusive comms', 'abusive', 'is-loss'),
      ),
    ),
  );
}

// ---- "What it costs you" ----------------------------------------------------

/**
 * The generalized tilt tax (spec #76): one row per mental axis, each priced in
 * winrate points only when BOTH sides carry at least COST_MIN_SAMPLE decided
 * (or rated) games — a delta off a thin or 0/0 sample would be noise dressed
 * up as coaching.
 */
function costsCard(ctx: ViewContext): HTMLElement {
  const c = ctx.data.mentalCosts;
  return card({ title: 'What it costs you', sub: `winrate points lost on the bad side · needs ≥${COST_MIN_SAMPLE} decided games each side` },
    h('div', { class: 'stack', style: { gap: '11px', marginTop: '4px' } },
      taxRow(ctx, 'Tilt tax', c.tilt.calm, 'calm', c.tilt.tilted, 'tilted', 'tilt'),
      taxRow(ctx, 'Comms tax', c.comms.positive, 'positive', c.comms.abusive, 'abusive', 'abusive'),
      taxRow(ctx, 'Toxic mates', c.toxic.without, 'without', c.toxic.with, 'with', 'toxicMates'),
      leaverRow(ctx, c.leaver),
      perfRow(c.performance),
    ),
  );
}

/** Label + right-aligned verdict on one line, a dim detail line under it. */
function costRow(label: string, verdict: Node | string, detail: Node | string, title?: string): HTMLElement {
  return h('div', { title },
    h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px' } },
      h('span', { style: { fontSize: '12.5px' } }, label),
      h('span', { class: 'mono', style: { fontSize: '12px' } }, verdict),
    ),
    h('div', { class: 'hint', style: { marginTop: '2px' } }, detail),
  );
}

/** The signed cost verdict: winning `cost` points less reads as a red −N pts. */
function costVerdict(cost: number, unit = ' pts'): Node | string {
  if (cost > 0) return h('span', { class: 'is-loss' }, `−${cost}${unit}`);
  if (cost < 0) return h('span', { class: 'is-win' }, `+${-cost}${unit}`);
  return 'even';
}

/** A two-sided winrate split row (good side vs bad side), gated on both
 *  samples. `badFlag`, when given, makes the bad-side percentage a link into
 *  Matches scoped to that flag — "show me those games" right next to the
 *  number that names them. */
function taxRow(
  ctx: ViewContext, label: string,
  good: WinrateSide, goodLabel: string, bad: WinrateSide, badLabel: string,
  badFlag?: MatchFlagKey,
): HTMLElement {
  if (good.decided < COST_MIN_SAMPLE || bad.decided < COST_MIN_SAMPLE) {
    return h('div', null,
      h('div', { style: { fontSize: '12.5px', marginBottom: '2px' } }, label),
      // F1: each side clamps to a check mark the instant IT meets the floor,
      // instead of the old raw "12/5" once only one side had cleared it.
      unlockHint(`Needs ${COST_MIN_SAMPLE} decided games on each side`, [
        { have: good.decided, need: COST_MIN_SAMPLE, label: goodLabel },
        { have: bad.decided, need: COST_MIN_SAMPLE, label: badLabel },
      ]),
    );
  }
  const cost = Math.round((good.winrate - bad.winrate) * 100);
  const badPct = badFlag
    ? inlineLink(pct(bad.winrate), { title: `Show the ${badLabel} games`, onClick: () => ctx.navigate('matches', { flag: badFlag }) })
    : pct(bad.winrate);
  return costRow(label, costVerdict(cost),
    h('span', null, `${pct(good.winrate)} ${goodLabel} · `, badPct, ` ${badLabel}`),
    `${pct(good.winrate)} ${goodLabel} − ${pct(bad.winrate)} ${badLabel} = ${cost} winrate points`);
}

/**
 * The three-way leaver swing: the verdict prices a my-team leaver against
 * leaver-free games; the enemy side is reported separately (its swing should
 * be positive — a my-team cost must never hide behind it).
 */
function leaverRow(ctx: ViewContext, l: { none: WinrateSide; myTeam: WinrateSide; enemy: WinrateSide }): HTMLElement {
  const side = (s: WinrateSide): string => (s.decided >= COST_MIN_SAMPLE ? pct(s.winrate) : `— (${s.decided}g)`);
  if (l.myTeam.decided < COST_MIN_SAMPLE || l.none.decided < COST_MIN_SAMPLE) {
    return h('div', null,
      h('div', { style: { fontSize: '12.5px', marginBottom: '2px' } }, 'Leaver swing'),
      unlockHint(`Needs ${COST_MIN_SAMPLE} decided games on each side`, [
        { have: l.myTeam.decided, need: COST_MIN_SAMPLE, label: 'my team' },
        { have: l.none.decided, need: COST_MIN_SAMPLE, label: 'none' },
      ]),
      h('div', { class: 'hint', style: { marginTop: '4px' } }, `${side(l.enemy)} enemy so far`),
    );
  }
  const cost = Math.round((l.none.winrate - l.myTeam.winrate) * 100);
  const myTeamLink = inlineLink(side(l.myTeam), { title: 'Show the my-team-leaver games', onClick: () => ctx.navigate('matches', { flag: 'leaver' }) });
  return costRow('Leaver swing', costVerdict(cost),
    h('span', null, myTeamLink, ' my team · ', side(l.none), ' none · ', side(l.enemy), ' enemy'),
    `${side(l.none)} none − ${side(l.myTeam)} my team = ${cost} winrate points`);
}

/** The performance drop when tilted (0–100 self-rating), gated on rated games. */
function perfRow(p: { calm: RatedSide; tilted: RatedSide }): HTMLElement {
  if (p.calm.rated < COST_MIN_SAMPLE || p.tilted.rated < COST_MIN_SAMPLE || p.calm.avg === null || p.tilted.avg === null) {
    return h('div', null,
      h('div', { style: { fontSize: '12.5px', marginBottom: '2px' } }, 'Performance when tilted'),
      unlockHint(`Needs ${COST_MIN_SAMPLE} rated games on each side`, [
        { have: p.calm.rated, need: COST_MIN_SAMPLE, label: 'calm' },
        { have: p.tilted.rated, need: COST_MIN_SAMPLE, label: 'tilted' },
      ]),
    );
  }
  const drop = Math.round(p.calm.avg - p.tilted.avg);
  return costRow('Performance when tilted', h('span', null, costVerdict(drop, ''), ' / 100 self-rating'),
    `${p.calm.avg} calm · ${p.tilted.avg} tilted`,
    `mean self-rating ${p.calm.avg} calm vs ${p.tilted.avg} tilted`);
}

// ---- Trends & session triggers ------------------------------------------------

/** The coach copy for each tilt-trend direction (lower tilt rate = improving), S9. */
const TREND_META: Record<TiltTrendDirection, { cls: string; arrow: string; verb: string; advice: string }> = {
  improving: { cls: 'is-win', arrow: '↓', verb: 'Improving', advice: 'Keep doing what you changed.' },
  worsening: { cls: 'is-loss', arrow: '↑', verb: 'Worsening', advice: 'Shorter sessions, earlier breaks.' },
  flat: { cls: 'u-dim', arrow: '→', verb: 'Flat', advice: 'No clear move either way yet.' },
};

/**
 * Flagged (tilted) games needed across both halves before the tilt-trend
 * verdict's imperative advice speaks (F6) — the 5-games-PER-HALF gate above
 * only guards the RATE being meaningful; a 5-and-5 split can still turn on
 * as few as 1-2 actual flags, not enough to hang "shorter sessions, earlier
 * breaks" on. `flat` has no imperative clause to gate — its neutral advice
 * always shows.
 */
const TILT_TREND_FLAGGED_MIN = 3;

/**
 * Per-day tilt-rate chart + the improving/worsening read (S9). A readable,
 * hoverable `lineChart` (fixed 0–100% axis) replaces the old `sparkline()`,
 * which auto-scaled to the data's own min…max — a 0→10% wobble filled the
 * full height and read as a violent swing.
 */
function trendsCard(ctx: ViewContext): HTMLElement {
  const points = ctx.data.tiltTrend;
  if (points.length < 2) {
    return card({ title: 'Trends', sub: 'share of games flagged tilted, per day' },
      h('div', { class: 'hint', style: { marginTop: '4px', lineHeight: '1.5' } },
        'Not enough days with games in this range to draw a tilt-rate trend yet — keep flagging games.'));
  }
  const read = tiltTrendDirection(points);
  const wrPoints: WrPoint[] = points.map((p) => ({ label: p.date, winrate: p.rate, games: p.games }));
  const byDate = new Map(points.map((p) => [p.date, p]));
  return chartCard({
    title: 'Trends',
    sub: 'share of games flagged tilted, per day',
    columns: [
      { key: 'label', label: 'Day' },
      { key: 'rate', label: 'Tilted', render: (v) => pct(v as number) },
      { key: 'games', label: 'Games' },
    ],
    rows: points.map((p) => ({ label: p.date, rate: p.rate, games: p.games })),
    initialSort: { key: 'label', dir: 1 },
  },
  h('div', null,
    lineChart(wrPoints, undefined, [], (p) => {
      const src = byDate.get(p.label);
      return src ? `${src.date} · ${src.tilted} of ${src.games} games tilted` : `${p.label} · ${pct(p.winrate)}`;
    }),
    h('div', { class: 'hint', style: { marginTop: '10px', lineHeight: '1.5' } },
      read
        ? read.direction === 'flat' || confidenceTier(read.flaggedGames, TILT_TREND_FLAGGED_MIN) === 'ok'
          ? h('span', { class: TREND_META[read.direction].cls },
              `${TREND_META[read.direction].arrow} ${TREND_META[read.direction].verb} — ${pct(read.earlyRate)} → ${pct(read.lateRate)} `
              + `(earlier vs recent half). ${TREND_META[read.direction].advice}`)
          : h('span', { class: TREND_META[read.direction].cls },
              `Early read: tilt rate ${read.direction === 'worsening' ? 'up' : 'down'} on ${read.flaggedGames} flag${read.flaggedGames === 1 ? '' : 's'}.`)
        : h('span', { class: 'u-dim' }, `Not enough games in each half of the range to read a direction yet (${COST_MIN_SAMPLE} each needed).`)),
  ));
}

/**
 * One tilt-rate bar: label, bar, "rate · games" — shared by every "when do I
 * tilt" trigger block (S9), including Session's "Game # in sitting" list.
 * Below {@link COST_MIN_SAMPLE} games, the bar itself dims (F6) — every
 * caller already gates its OWN interpretive verdict on this same floor per
 * bucket, but used to still draw a full-strength red bar for a 1-game
 * position regardless, reading as equally trustworthy as a well-sampled one.
 */
function tiltRow(label: string, b: TiltBucket): HTMLElement {
  const thin = b.games < COST_MIN_SAMPLE;
  return statBar({
    label,
    frac: b.rate,
    color: thin ? PALETTE.muted : PALETTE.loss,
    valueText: h('span', { style: { display: 'inline-flex', alignItems: 'baseline', gap: '5px', ...(thin ? { opacity: '0.6' } : {}) } },
      h('span', { style: { minWidth: '30px', textAlign: 'right' } }, pct(b.rate)),
      h('span', null, '·'),
      h('span', { style: { minWidth: '20px', textAlign: 'right' } }, `${b.games}g`),
    ),
    slim: true,
    valueWidth: 66,
    title: thin ? `Under ${COST_MIN_SAMPLE} games — not read` : undefined,
  });
}

/** "Time of day" trigger block — do I tilt more in a particular day-part? */
function timeOfDayTrigger(buckets: TiltBucket[]): HTMLElement | null {
  if (!buckets.length) return null;
  const sampled = buckets.filter((b) => b.games >= COST_MIN_SAMPLE);
  const worst = [...sampled].sort((a, b) => b.rate - a.rate)[0];
  const best = [...sampled].sort((a, b) => a.rate - b.rate)[0];
  return h('div', null,
    h('div', { class: 'u-muted', style: { fontSize: '11px', marginBottom: '5px' } }, 'Time of day'),
    h('div', { class: 'stack', style: { gap: '5px' } }, ...buckets.map((b) => tiltRow(b.key, b))),
    worst && best && worst.key !== best.key
      ? h('div', { class: 'hint', style: { marginTop: '6px', lineHeight: '1.5' } },
          `You tilt most in the ${worst.key.toLowerCase()} (${pct(worst.rate)}) — least in the ${best.key.toLowerCase()} (${pct(best.rate)}).`)
      : null,
  );
}

/** "After your last game" trigger block — do I tilt more right after a loss? */
function afterResultTrigger(split: { afterWin: TiltBucket; afterLoss: TiltBucket }): HTMLElement | null {
  const { afterWin, afterLoss } = split;
  if (!afterWin.games && !afterLoss.games) return null;
  const sampled = afterWin.games >= COST_MIN_SAMPLE && afterLoss.games >= COST_MIN_SAMPLE;
  const coach = !sampled
    ? h('span', { class: 'u-dim' }, `Needs ${COST_MIN_SAMPLE} games after each result to compare.`)
    : afterLoss.rate <= afterWin.rate
      ? 'No clear tilt bump right after a loss.'
      : afterWin.rate === 0
        ? "You tilt after a loss but never after a win — that's the break the reminder is for."
        : `You tilt ${Math.round((afterLoss.rate / afterWin.rate) * 10) / 10}× as often right after a loss — `
          + "that's the break the reminder is for.";
  return h('div', null,
    h('div', { class: 'u-muted', style: { fontSize: '11px', marginBottom: '5px' } }, 'After your last game'),
    h('div', { class: 'stack', style: { gap: '5px' } },
      tiltRow('After a win', afterWin),
      tiltRow('After a loss', afterLoss),
    ),
    h('div', { class: 'hint', style: { marginTop: '6px', lineHeight: '1.5' } }, coach),
  );
}

/** "By map" trigger block — the top 3 maps by tilt rate, 3+ games. */
function byMapTrigger(buckets: TiltBucket[]): HTMLElement | null {
  if (!buckets.length) return null;
  return h('div', null,
    h('div', { class: 'u-muted', style: { fontSize: '11px', marginBottom: '5px' } }, 'By map'),
    h('div', { class: 'stack', style: { gap: '5px' } }, ...buckets.map((b) => tiltRow(b.key, b))),
    h('div', { class: 'hint', style: { marginTop: '6px', lineHeight: '1.5' } }, 'Top 3 by tilt rate, 3+ games.'),
  );
}

/**
 * "Pre-session check-in" trigger block (S10 phase 2) — does queuing up
 * already tilted actually predict a tilted game 1, or is the check-in just
 * a feeling that doesn't pan out? `'none'` (no qualifying check-in) renders
 * as a plain baseline row alongside the three moods.
 */
function checkInTrigger(buckets: TiltBucket[]): HTMLElement | null {
  if (!buckets.length) return null;
  const rowLabel = (key: string): string => key === 'none' ? 'No check-in' : CHECK_IN_LABELS[key as CheckInMood];
  const calm = buckets.find((b) => b.key === 'calm');
  const tilted = buckets.find((b) => b.key === 'tilted');
  const sampled = calm && tilted && calm.games >= COST_MIN_SAMPLE && tilted.games >= COST_MIN_SAMPLE;
  const coach = !sampled
    ? h('span', { class: 'u-dim' }, `Needs ${COST_MIN_SAMPLE} calm and tilted check-ins each to compare.`)
    : tilted!.rate <= calm!.rate
      ? 'Checking in tilted hasn’t actually predicted a tilted game 1 yet.'
      : calm!.rate === 0
        ? 'You’ve tilted game 1 after checking in tilted, but never after checking in calm.'
        : `Checking in tilted before queuing tilts game 1 ${Math.round((tilted!.rate / calm!.rate) * 10) / 10}× as often as checking in calm.`;
  return h('div', null,
    h('div', { class: 'u-muted', style: { fontSize: '11px', marginBottom: '5px' } }, 'Pre-session check-in'),
    h('div', { class: 'stack', style: { gap: '5px' } }, ...buckets.map((b) => tiltRow(rowLabel(b.key), b))),
    h('div', { class: 'hint', style: { marginTop: '6px', lineHeight: '1.5' } }, coach),
  );
}

/**
 * Tilt rate by game # within a sitting — the "stop after game N" read (issue
 * #70 C) — plus the "when do I tilt" triggers (S9): time of day, right after
 * a loss, and by map. `byTimeOfDay`/`bySessionPosition`/`byMap` all already
 * existed as analytics; only the crossing with tilt was ever missing.
 */
function sessionCard(ctx: ViewContext): HTMLElement {
  const d = ctx.data;
  const buckets = d.tiltBySession;
  const triggers = [
    timeOfDayTrigger(d.tiltByTimeOfDay),
    afterResultTrigger(d.tiltAfterResult),
    byMapTrigger(d.tiltByMap),
    checkInTrigger(d.tiltByCheckIn),
  ].filter((n): n is HTMLElement => n != null);
  if (!buckets.length) {
    return card({ title: 'Session & triggers', sub: 'tilt rate by game # in a sitting, time of day, after a loss, and by map' },
      h('div', { class: 'hint', style: { marginTop: '4px', lineHeight: '1.5' } },
        'No games in this range yet — the per-position tilt read appears once you have sittings to compare.'),
      triggers.length ? h('div', { class: 'stack', style: { gap: '14px', marginTop: '12px' } }, ...triggers) : null,
    );
  }
  // The stop-point claim needs a bucket that can carry it: enough games AND
  // actual tilt at that position. Thin or tilt-free peaks stay unclaimed.
  const sampled = buckets.some((b) => b.games >= COST_MIN_SAMPLE);
  const peak = buckets
    .filter((b) => b.games >= COST_MIN_SAMPLE && b.tilted > 0)
    .sort((a, b) => b.rate - a.rate)[0];
  return card({
    title: 'Session & triggers',
    // F6: the floor stated once here, instead of every dimmed bar needing
    // its own explanation — same "state the unit once" stance "What it
    // costs you"'s sub already takes.
    sub: `tilt rate by game # in a sitting, time of day, after a loss, and by map · ≥${COST_MIN_SAMPLE} games per position`,
  },
    h('div', { class: 'u-muted', style: { fontSize: '11px', marginBottom: '5px' } }, 'Game # in sitting'),
    h('div', { class: 'stack', style: { gap: '9px', marginTop: '4px' } },
      ...buckets.map((b) => tiltRow(`Game ${b.key}`, b)),
    ),
    h('div', { class: 'hint', style: { marginTop: '10px', lineHeight: '1.5' } },
      peak
        ? h('span', null, 'Tilt peaks at ', h('span', { class: 'is-loss' }, `game ${peak.key}`),
            ` — ${pct(peak.rate)} of ${peak.games} games. `,
            // "Break before game 1" is not advice — a first-game peak means the
            // tilt walks in with you, so the nudge points at the queue-up instead.
            peak.key === '1' ? 'You may be queuing already tilted — check in before you start.' : 'Plan the break before then.')
        // Two distinct empty states: genuinely thin samples vs. plenty of
        // games but no tilt flagged anywhere — don't blame sample size for
        // the latter (AC7: no fake/false reasons in empty states).
        : sampled
          ? 'No tilt flagged at any position in this range — nothing to call a stop point from.'
          : `Not enough games per position yet (${COST_MIN_SAMPLE} needed) to call a stop point.`),
    triggers.length
      ? h('div', { class: 'stack', style: { gap: '14px', marginTop: '16px', paddingTop: '14px', borderTop: '1px solid var(--border)' } }, ...triggers)
      : null,
    stopRuleLine(ctx),
  );
}

/** A "Flags this range" stat box; clickable when its count is non-zero, opening
 *  Matches scoped to that flag. A zero count is dimmed rather than styled like
 *  the clickable ones — `.stat-box--link` (accent border, hover lift, trailing
 *  arrow) is what actually distinguishes a drill-down from the hero drawer's
 *  identical-looking, inert stat grid. */
function flagBox(ctx: ViewContext, count: number, label: string, flag: MatchFlagKey, valueClass?: string): HTMLElement {
  const value = valueClass ? h('span', { class: valueClass }, String(count)) : String(count);
  if (count <= 0) return h('div', { class: 'u-dim' }, statBox(value, label));
  return inlineLink(statBox(value, label), {
    class: 'stat-box--link',
    style: { display: 'block', width: '100%', textAlign: 'left' },
    title: `Show the ${FLAG_LABELS[flag]}-flagged games`,
    onClick: () => ctx.navigate('matches', { flag }),
  });
}
