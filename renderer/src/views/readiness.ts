/**
 * Readiness / training-load coach screen. Shows the readiness verdict as a clear
 * traffic-light read + rest recommendation, the contributing signals, the
 * training-load numbers, and a trend chart. All explanation now lives in the
 * on-demand help wiki (global Help + a per-card "?"); the view itself stays
 * data-first, keeping only the single honest "wellness heuristic, not a
 * diagnosis" line in its subtitle.
 */
import { h } from '../dom';
import type { ReadinessBand, ReadinessRegime, ReadinessSignal, ReadinessSubscore, ReadinessSummary } from '../../../src/shared/contract';
import { PALETTE } from '../theme';
import { badge, button, card, statBox } from '../components/primitives';
import { readinessChart } from '../charts/plots';
import { readinessSettingsEditor } from '../components/readinessSettingsEditor';
import { openReadinessWiki } from '../app/readinessWiki';
import type { WikiArticleId } from '../app/readinessWiki/types';
import { viewHead, type ViewContext } from './view';

const BAND: Record<ReadinessBand, { label: string; color: string }> = {
  fresh: { label: 'Fresh', color: PALETTE.win },
  steady: { label: 'Steady', color: PALETTE.win },
  loaded: { label: 'Loaded', color: PALETTE.mid },
  'in-the-hole': { label: 'In the hole', color: PALETTE.loss },
  recovering: { label: 'Recovering', color: PALETTE.accentBright },
  rusty: { label: 'Rusty', color: PALETTE.info },
  'insufficient-data': { label: 'Not enough data', color: PALETTE.muted },
};

const SEV: Record<ReadinessSignal['severity'], string> = {
  high: PALETTE.loss,
  watch: PALETTE.mid,
  ok: PALETTE.muted,
};

/** Which evidence the verdict rests on — the badge on the Verdict card. The full
 *  explanation now lives in the wiki, so only the terse label + kind remain. */
const REGIME_META: Record<ReadinessRegime, { label: string; kind: 'auto' | 'hybrid' | 'manual' }> = {
  stats: { label: '⚡ based on live match stats', kind: 'auto' },
  hybrid: { label: '⚡◎ blending live stats + manual logs', kind: 'hybrid' },
  manual: { label: '◎ based on your manual logs', kind: 'manual' },
};

/** Bands whose acute window is empty/absent, so a regime badge would misleadingly claim 'manual'. */
function showRegime(band: ReadinessBand): boolean {
  return band !== 'insufficient-data' && band !== 'rusty';
}

export function readiness(ctx: ViewContext): HTMLElement {
  if (!ctx.data.readinessSettings.enabled) return disabledView(ctx);

  const r = ctx.data.readiness;
  return h('div', { class: 'view' },
    viewHead('Readiness', 'Training load & recovery — a wellness heuristic, not a diagnosis', globalHelp(ctx)),
    h('div', { class: 'grid-2' }, verdictCard(ctx), whyCard(r)),
    subscoresCard(ctx),
    loadCard(ctx),
    chartCard(ctx),
    card({ title: 'Settings' }, readinessSettingsEditor(ctx)),
  );
}

/** Global "Help" — opens the readiness guide at its Overview. */
function globalHelp(ctx: ViewContext): HTMLElement {
  return button('Help', { variant: 'ghost', onClick: () => openReadinessWiki(ctx) });
}

/** A card's "?" — deep-links the readiness guide to that card's article (plain tier). */
function cardHelp(ctx: ViewContext, id: WikiArticleId): HTMLElement {
  return h('button', {
    class: 'inline-link',
    title: 'Open the readiness guide',
    'aria-label': 'Open the readiness guide',
    style: { fontSize: '13px', fontWeight: '600' },
    on: { click: () => openReadinessWiki(ctx, { view: 'article', id, tier: 'plain' }) },
  }, '?');
}

/** One family's pull on the composite: signed delta + a small magnitude bar.
 *  A bare track (not statBar) — statBar reserves fixed label/value gutters that
 *  would leave ~35% of the tile blank here (review finding). */
function subscoreTile(label: string, sub: ReadinessSubscore, maxAbs: number, note?: string): HTMLElement {
  const delta = sub.delta;
  const value = !sub.available ? '—' : `${delta > 0 ? '+' : ''}${Math.round(delta * 10) / 10}`;
  const color = !sub.available || Math.abs(delta) < 1 ? PALETTE.muted : delta < 0 ? (delta <= -maxAbs / 2 ? PALETTE.loss : PALETTE.mid) : PALETTE.win;
  const frac = sub.available ? Math.min(1, Math.abs(delta) / maxAbs) : 0;
  return h('div', null,
    statBox(value, label),
    h('div', { class: 'track', style: { marginTop: '6px' } },
      h('div', { class: 'track-fill', style: { width: `${Math.round(frac * 100)}%`, background: color } })),
    h('div', { class: 'hint', style: { marginTop: '4px', fontSize: '11px' } },
      !sub.available ? (note ?? 'no usable data yet') : note ?? ''),
  );
}

/** The three signal families behind the score — research says exposing the WHY
 *  is what makes a composite score trustworthy. */
function subscoresCard(ctx: ViewContext): HTMLElement {
  const s = ctx.data.readiness.subscores;
  const statNote = s.performance.available
    ? `stat coverage ${Math.round((s.performance.coverage ?? 0) * 100)}%`
    : 'needs tracked games with stats';
  const subjNote = s.subjective.available ? '' : 'log mental state or rate your games';
  return card({ title: 'What moves the score', sub: 'from a neutral 75', actions: cardHelp(ctx, 'what-moves-the-score') },
    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginTop: '4px' } },
      subscoreTile('Load balance', s.load, 40),
      subscoreTile('Performance vs your usual', s.performance, 45, statNote),
      subscoreTile('Self-report', s.subjective, 15, subjNote),
    ),
  );
}

/** Bands where training load is the concern — worth pointing at the break reminder. */
const BREAK_REMINDER_BANDS: ReadinessBand[] = ['loaded', 'in-the-hole'];

function verdictCard(ctx: ViewContext): HTMLElement {
  const r = ctx.data.readiness;
  const meta = BAND[r.band];
  const regime = REGIME_META[r.regime];
  // When confidence is low we deliberately suppress the crisp number so it never
  // reads as more certain than it is.
  const showScore = r.score !== null && r.confidence !== 'low';
  const help = cardHelp(ctx, 'verdict');
  return card(
    // The "?" renders independently of the regime badge (which showRegime nulls
    // for insufficient-data/rusty) — help must never vanish when it's most needed.
    { title: 'Verdict', actions: showRegime(r.band) ? [badge(regime.label, regime.kind), help] : [help] },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', marginTop: '4px' } },
      h('span', { style: { width: '14px', height: '14px', borderRadius: '50%', background: meta.color, flex: '0 0 auto' } }),
      h('span', { style: { fontSize: '20px', fontWeight: '700' } }, meta.label),
      showScore
        ? h('span', { class: 'mono', style: { marginLeft: 'auto', fontSize: '24px', fontWeight: '700', color: meta.color } }, String(r.score))
        : null,
    ),
    h('div', { style: { fontSize: '13.5px', marginTop: '10px', lineHeight: '1.5' } }, r.headline),
    r.recommendationText
      ? h('div', { style: { fontSize: '12.5px', marginTop: '8px', color: meta.color, lineHeight: '1.5' } }, r.recommendationText)
      : null,
    BREAK_REMINDER_BANDS.includes(r.band) ? breakReminderHint(ctx) : null,
    h('div', { class: 'hint', style: { marginTop: '10px' } },
      `Confidence: ${r.confidence} · `,
      h('button', {
        class: 'inline-link',
        title: 'How the readiness verdict is calculated',
        on: { click: () => openReadinessWiki(ctx, { view: 'article', id: 'verdict', tier: 'plain' }) },
      }, 'How is this calculated?'),
    ),
  );
}

/** Loaded / in-the-hole verdicts point at the break reminder — it's the lever
 *  that lives on Mental, so link straight there instead of leaving it implicit. */
function breakReminderHint(ctx: ViewContext): HTMLElement {
  const br = ctx.data.breakReminder;
  const status = br.enabled
    ? `Break reminder is on after ${br.afterLosses} loss${br.afterLosses === 1 ? '' : 'es'}.`
    : 'Break reminder is off.';
  return h('div', { class: 'hint', style: { marginTop: '8px', lineHeight: '1.5' } },
    `${status} `,
    h('button', {
      class: 'inline-link',
      title: 'Open the Mental screen',
      on: { click: () => ctx.navigate('mental') },
    }, 'Open Mental →'),
  );
}

function whyCard(r: ReadinessSummary): HTMLElement {
  return card({ title: 'Why' },
    r.signals.length
      ? h('div', { class: 'stack', style: { gap: '8px', marginTop: '4px' } },
          ...r.signals.map((s) => h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
            h('span', { style: { width: '8px', height: '8px', borderRadius: '50%', background: SEV[s.severity], flex: '0 0 auto' } }),
            h('span', { style: { fontSize: '12.5px' } }, s.label),
          )))
      : h('div', { class: 'hint', style: { marginTop: '4px' } },
          r.band === 'insufficient-data'
            ? 'Keep logging games to unlock a readiness read.'
            : 'Nothing notable — your load and mental signals look balanced.'),
  );
}

function loadCard(ctx: ViewContext): HTMLElement {
  const l = ctx.data.readiness.load;
  return card({ title: 'Training load', sub: 'across all your accounts', actions: cardHelp(ctx, 'training-load') },
    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '10px', marginTop: '4px' } },
      statBox(String(l.acutePerDay), 'games/day (recent)'),
      statBox(`${l.ratio.toFixed(2)}×`, 'vs baseline'),
      statBox(String(l.consecutiveDays), 'days in a row'),
      statBox(String(Math.round(l.activeDaysPerWeek)), 'active days/week'),
      statBox(l.restDays === 0 ? 'today' : `${l.restDays}d ago`, 'last played'),
    ),
    l.lastSessionGames
      ? h('div', { class: 'hint', style: { marginTop: '10px' } },
          `Last session: ${l.lastSessionGames} game${l.lastSessionGames === 1 ? '' : 's'}${l.lastSessionMinutes != null ? ` · ~${l.lastSessionMinutes} min` : ''}.`)
      : null,
  );
}

function chartCard(ctx: ViewContext): HTMLElement {
  return card({ title: 'Readiness trend', sub: 'last 3 weeks · higher = fresher', actions: cardHelp(ctx, 'readiness-trend') },
    readinessChart(ctx.data.readiness.trend),
  );
}

function disabledView(ctx: ViewContext): HTMLElement {
  return h('div', { class: 'view' },
    viewHead('Readiness', 'Training load & recovery', globalHelp(ctx)),
    card({ title: 'Readiness coach is off' },
      h('div', { class: 'hint', style: { marginBottom: '6px' } },
        'Turn it on to track training load and get rest recommendations from your history and mental tracking.'),
      readinessSettingsEditor(ctx),
    ),
  );
}
