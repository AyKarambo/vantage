/**
 * Readiness / training-load coach screen. Shows the readiness verdict as a clear
 * traffic-light read + rest recommendation, the contributing signals, the
 * training-load numbers, and a trend chart. All explanation now lives in the
 * on-demand help wiki, opened from a single global Help button; the view stays
 * data-first, keeping only the single honest "wellness heuristic, not a
 * diagnosis" line in its subtitle.
 */
import { h } from '../dom';
import type { ReadinessBand, ReadinessRegime, ReadinessSignal, ReadinessSubscore, ReadinessSummary } from '../../../src/shared/contract';
import type { WikiArticleId } from '../app/readinessWiki/types';
import { PALETTE } from '../theme';
import { badge, button, card, statBox } from '../components/primitives';
import { inlineLink } from '../components/inlineLink';
import { readinessChart } from '../charts/plots';
import { readinessSettingsEditor } from '../components/readinessSettingsEditor';
import { openReadinessWiki } from '../app/readinessWiki';
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

/**
 * A signal's dot colour (C8) — a function of (severity, band), not severity
 * alone: 'high' only renders true red under an actually-alarming band
 * (loaded/in-the-hole). Under a green band (e.g. a genuinely fired load
 * streak the other families offset) it renders amber instead — a signal
 * that crossed its own 'high' threshold isn't the same claim as "your
 * overall state is bad" once the composite score has already said otherwise.
 */
function sevColor(severity: ReadinessSignal['severity'], band: ReadinessBand): string {
  if (severity === 'ok') return PALETTE.muted;
  if (severity === 'watch') return PALETTE.mid;
  return band === 'loaded' || band === 'in-the-hole' ? PALETTE.loss : PALETTE.mid;
}

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
    h('div', { class: 'grid-2' }, verdictCard(ctx), whyCard(ctx, r)),
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

/** Deep-links a card straight to its own wiki article (C8) — every card gets one, not just Verdict. */
function wikiButton(ctx: ViewContext, id: WikiArticleId): HTMLElement {
  return button('?', {
    variant: 'ghost',
    title: 'How this is calculated',
    onClick: () => openReadinessWiki(ctx, { view: 'article', id, tier: 'plain' }),
  });
}

const fmtBound = (n: number): string => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);

/**
 * One family's pull on the composite: signed delta + a DIVERGING bar (C8)
 * centred at 0 rather than a magnitude-only fill from the left edge — each
 * family's bounds are asymmetric (load can cost up to 40 but only earn up to
 * 25), so a plain 0..max fill made a −4 and a +4 look like the same distance
 * from neutral when they aren't. `bounds` mirrors `READINESS_TUNING`'s
 * `{load,perf,subj}DeltaMin/Max` (display-only — not threaded through the
 * contract, same as the score card's hardcoded "75").
 * A bare track (not statBar) — statBar reserves fixed label/value gutters that
 * would leave ~35% of the tile blank here (review finding).
 */
function subscoreTile(label: string, sub: ReadinessSubscore, bounds: { min: number; max: number }, note?: string): HTMLElement {
  const delta = sub.delta;
  const { min, max } = bounds;
  const span = max - min;
  const value = !sub.available ? '—' : `${delta > 0 ? '+' : ''}${Math.round(delta * 10) / 10}`;
  const color = !sub.available || Math.abs(delta) < 1 ? PALETTE.muted : delta < 0 ? (delta <= min / 2 ? PALETTE.loss : PALETTE.mid) : PALETTE.win;
  const zeroPct = (-min / span) * 100;
  const deltaPct = sub.available ? ((delta - min) / span) * 100 : zeroPct;
  const left = Math.min(zeroPct, deltaPct);
  const width = Math.abs(deltaPct - zeroPct);
  return h('div', null,
    statBox(value, label),
    h('div', { class: 'track', style: { marginTop: '6px', position: 'relative' } },
      h('div', { style: { position: 'absolute', left: `${zeroPct}%`, top: '0', bottom: '0', width: '1px', background: 'var(--border)' } }),
      h('div', { class: 'track-fill', style: { position: 'absolute', left: `${left}%`, width: `${width}%`, top: '0', bottom: '0', background: color } }),
    ),
    h('div', { class: 'hint', style: { marginTop: '4px', fontSize: '11px' } },
      !sub.available ? (note ?? 'no usable data yet') : note ?? ''),
    h('div', { class: 'u-dim', style: { fontSize: '10px', marginTop: '2px' } }, `${fmtBound(min)} … ${fmtBound(max)}`),
  );
}

/** The three signal families behind the score — research says exposing the WHY
 *  is what makes a composite score trustworthy. */
/**
 * The live arithmetic behind the score (C8) — "75 − 4 − 3.3 = 68" — instead
 * of leaving the reader to eyeball three magnitude bars and do the sum
 * themselves. Gated the same way the Verdict card hides the crisp score at
 * low confidence, so the equation never states a false precision either.
 */
function scoreEquation(r: ReadinessSummary): string {
  const { load, performance, subjective } = r.subscores;
  const term = (n: number): string => `${n >= 0 ? '+' : '−'} ${Math.abs(Math.round(n * 10) / 10)}`;
  return `75 ${term(load.delta)} ${term(performance.delta)} ${term(subjective.delta)} = ${r.score}`;
}

function subscoresCard(ctx: ViewContext): HTMLElement {
  const r = ctx.data.readiness;
  const s = r.subscores;
  const statNote = s.performance.available
    ? `stat coverage ${Math.round((s.performance.coverage ?? 0) * 100)}%`
    : 'needs tracked games with stats';
  const subjNote = s.subjective.available ? '' : 'log mental state or rate your games';
  const sub = r.score !== null && r.confidence !== 'low' ? scoreEquation(r) : 'from a neutral 75';
  return card({ title: 'What moves the score', sub, actions: wikiButton(ctx, 'what-moves-the-score') },
    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginTop: '4px' } },
      subscoreTile('Load balance', s.load, { min: -40, max: 25 }),
      subscoreTile('Performance vs your usual', s.performance, { min: -45, max: 8 }, statNote),
      subscoreTile('Self-report', s.subjective, { min: -15, max: 8 }, subjNote),
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
  const actions = [showRegime(r.band) ? badge(regime.label, regime.kind) : null, wikiButton(ctx, 'verdict')];
  return card(
    { title: 'Verdict', actions },
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
    h('div', { class: 'hint', style: { marginTop: '10px' } }, `Confidence: ${r.confidence}`),
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
    inlineLink('Open Mental →', {
      title: 'Open the Mental screen',
      onClick: () => ctx.navigate('mental'),
    }),
  );
}

function whyCard(ctx: ViewContext, r: ReadinessSummary): HTMLElement {
  return card({ title: 'Why', actions: wikiButton(ctx, 'verdict') },
    r.signals.length
      ? h('div', { class: 'stack', style: { gap: '8px', marginTop: '4px' } },
          ...r.signals.map((s) => h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
            h('span', { style: { width: '8px', height: '8px', borderRadius: '50%', background: sevColor(s.severity, r.band), flex: '0 0 auto' } }),
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
  return card({ title: 'Training load', sub: 'across all your accounts', actions: wikiButton(ctx, 'training-load') },
    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '10px', marginTop: '4px' } },
      statBox(String(l.acutePerDay), 'games/day (recent)', 'Mean games/day over your last 3 active days.'),
      statBox(`${l.ratio.toFixed(2)}×`, 'vs baseline', 'Recent games/day divided by your smoothed 21-day baseline — 1.00× is right on habit.'),
      statBox(String(l.consecutiveDays), 'days in a row', 'Active days in a row ending today, with no rest day between.'),
      statBox(String(Math.round(l.activeDaysPerWeek)), 'active days/week', 'How many days a week you play, averaged over your last 21 days.'),
      statBox(l.restDays === 0 ? 'today' : `${l.restDays}d ago`, 'last played', 'How long since your last tracked game.'),
    ),
    l.lastSessionGames
      ? h('div', { class: 'hint', style: { marginTop: '10px' } },
          `Last session: ${l.lastSessionGames} game${l.lastSessionGames === 1 ? '' : 's'}${l.lastSessionMinutes != null ? ` · ~${l.lastSessionMinutes} min` : ''}.`)
      : null,
  );
}

function chartCard(ctx: ViewContext): HTMLElement {
  return card({ title: 'Readiness trend', sub: 'last 3 weeks · higher = fresher', actions: wikiButton(ctx, 'readiness-trend') },
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
