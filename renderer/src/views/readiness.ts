/**
 * Readiness / training-load coach screen. Turns the readiness verdict into a
 * clear traffic-light read + rest recommendation, the contributing signals, the
 * training-load numbers, a trend chart, and — importantly — an honest note that
 * this is a wellness heuristic, not a diagnosis.
 */
import { h } from '../dom';
import type { ReadinessBand, ReadinessRegime, ReadinessSignal, ReadinessSubscore, ReadinessSummary } from '../../../src/shared/contract';
import { PALETTE } from '../theme';
import { badge, button, card, statBox } from '../components/primitives';
import { openModal } from '../components/overlay';
import { readinessChart, supercompensationSchematic } from '../charts/plots';
import { readinessSettingsEditor } from '../components/readinessSettingsEditor';
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

/** Which evidence the verdict rests on — the badge on the Verdict card + its hover explanation. */
const REGIME_META: Record<ReadinessRegime, { label: string; kind: 'auto' | 'hybrid' | 'manual'; title: string }> = {
  stats: {
    label: '⚡ based on live match stats',
    kind: 'auto',
    title: 'Full live-stat coverage — the model runs exactly as it always has.',
  },
  hybrid: {
    label: '⚡◎ blending live stats + manual logs',
    kind: 'hybrid',
    title: 'Live match stats and your manual logs are blended continuously as coverage rises or falls — no cliff either way.',
  },
  manual: {
    label: '◎ based on your manual logs',
    kind: 'manual',
    title: 'Built from your manual logs only. Confidence is capped at medium until live match stats are available — a limit of the evidence, not a penalty.',
  },
};

/** Bands whose acute window is empty/absent, so a regime badge would misleadingly claim 'manual'. */
function showRegime(band: ReadinessBand): boolean {
  return band !== 'insufficient-data' && band !== 'rusty';
}

/** The Load tile's regime-aware footnote — explains the absolute-load arm when it contributes. */
function loadNote(r: ReadinessSummary): string | undefined {
  if (r.regime === 'stats') return undefined; // arm silent at full coverage — say nothing
  if (r.regime === 'manual') {
    return 'includes an absolute-load read (days without rest, daily volume, long sessions) — results can’t be measured without live match stats yet';
  }
  const b = r.subscores.load.coverage;
  const pct = b != null ? Math.round((1 - b) * 100) : null;
  return `partly includes an absolute-load read${pct != null ? ` (~${pct}% weight)` : ''} — fades out as live-stat coverage grows`;
}

export function readiness(ctx: ViewContext): HTMLElement {
  if (!ctx.data.readinessSettings.enabled) return disabledView(ctx);

  const r = ctx.data.readiness;
  return h('div', { class: 'view' },
    viewHead('Readiness', 'Training load & recovery — a wellness heuristic, not a diagnosis'),
    h('div', { class: 'grid-2' }, verdictCard(ctx), whyCard(r)),
    subscoresCard(r),
    loadCard(r),
    chartCard(r),
    honestyCard(),
    card({ title: 'Settings' }, readinessSettingsEditor(ctx)),
  );
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
function subscoresCard(r: ReadinessSummary): HTMLElement {
  const s = r.subscores;
  const statNote = s.performance.available
    ? `stat coverage ${Math.round((s.performance.coverage ?? 0) * 100)}%`
    : 'needs tracked games with stats';
  const subjNote = s.subjective.available ? '' : 'log mental state or rate your games';
  return card({ title: 'What moves the score', sub: 'each family pulls the score from its neutral anchor (75)' },
    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginTop: '4px' } },
      subscoreTile('Load balance', s.load, 40, loadNote(r)),
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
  const confidenceNote =
    r.confidence === 'low'
      ? ' — log your mental state after games to sharpen this'
      : r.regime === 'manual'
        ? ' — capped until live match stats are available'
        : '';
  return card(
    { title: 'Verdict', actions: showRegime(r.band) ? badge(regime.label, regime.kind, { title: regime.title }) : undefined },
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
      `Confidence: ${r.confidence}${confidenceNote} · `,
      h('button', {
        class: 'inline-link',
        title: 'How the readiness verdict is calculated',
        on: { click: () => openModal((close) => readinessMethodology(close)) },
      }, 'How is this calculated?'),
    ),
  );
}

/**
 * The full methodology behind the readiness verdict — verdict bands, signals,
 * the training-load model, the supercompensation model (including the
 * schematic moved out of the main view), confidence levels, and the honesty
 * disclaimer. Opened from `verdictCard`'s "How is this calculated?" link.
 */
function readinessMethodology(close: () => void): HTMLElement {
  return h('div', { class: 'stack', style: { gap: '16px', padding: '20px', width: '520px', maxWidth: '92vw' } },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
      h('div', { style: { fontFamily: 'var(--font-head)', fontSize: '16px', fontWeight: '600' } }, 'How readiness is calculated'),
      h('button', { class: 'overlay-close', title: 'Close', 'aria-label': 'Close', style: { marginLeft: 'auto' }, on: { click: close } }, '✕'),
    ),
    h('div', null,
      h('div', { style: { fontSize: '12.5px', fontWeight: '600', marginBottom: '6px' } }, 'Verdict bands'),
      h('div', { class: 'stack', style: { gap: '6px' } },
        ...(Object.keys(BAND) as ReadinessBand[]).map((band) =>
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
            h('span', { style: { width: '10px', height: '10px', borderRadius: '50%', background: BAND[band].color, flex: '0 0 auto' } }),
            h('span', { style: { fontSize: '12.5px' } }, BAND[band].label),
          ),
        ),
      ),
    ),
    h('div', null,
      h('div', { style: { fontSize: '12.5px', fontWeight: '600', marginBottom: '6px' } }, 'Contributing signals'),
      h('div', { class: 'hint', style: { lineHeight: '1.6' } },
        'Each signal watches one facet of load or mental state — game volume, session length, ' +
        'consecutive days played, layoffs, and self-reported mental state after games. A signal ' +
        'turns "watch" or "high" severity when it crosses a threshold tuned from training theory.'),
    ),
    h('div', null,
      h('div', { style: { fontSize: '12.5px', fontWeight: '600', marginBottom: '6px' } }, 'The three families & weights'),
      h('div', { class: 'hint', style: { lineHeight: '1.6' } },
        'The score starts at a neutral 75 and three families pull on it: behavioral load (up to ~40 ' +
        'points), objective performance vs your own baselines (up to ~45 — winrate and per-10-minute ' +
        'stats), and self-report (tilt + your performance rating, hard-capped at 15 so a feeling ' +
        'never outweighs the evidence). The verdict band derives from the score — they can’t disagree.'),
    ),
    h('div', null,
      h('div', { style: { fontSize: '12.5px', fontWeight: '600', marginBottom: '6px' } }, 'Which evidence it uses: stats vs manual'),
      h('div', { class: 'hint', style: { lineHeight: '1.6' } },
        'Live per-10 stats and session lengths come from Overwolf’s Game Events Provider, pending ' +
        'store approval — so most installs run on manual logs: your own results, tilt, and ratings. ' +
        'The verdict runs on whichever evidence actually exists. At full live-stat coverage (⚡) this ' +
        'is exactly the model as always. On manual logs (◎) two things change so the score can still ' +
        'move: results vs your own baseline count for more, and unmeasured exposure — consecutive ' +
        'days without rest, daily volume, marathon sessions — becomes evidence on its own, since ' +
        'there’s no outcome to weigh it against. In between (⚡◎ hybrid) the two blend continuously ' +
        'as coverage rises or falls — stats mode unlocks by itself once live capture lands; there’s ' +
        'no setting to flip. A stat only counts once a hero has enough history behind it for a fair ' +
        'comparison, so a stats-carrying history can still read as manual early on. Load alone never ' +
        'reaches In the hole in any regime — a real results dip or elevated tilt is always required.'),
    ),
    h('div', null,
      h('div', { style: { fontSize: '12.5px', fontWeight: '600', marginBottom: '6px' } }, 'When live capture drops out'),
      h('div', { class: 'hint', style: { lineHeight: '1.6' } },
        'Game updates can knock live capture out for a few days. The verdict eases toward hybrid or ' +
        'manual and back automatically as tracking resumes — missing stats are never read as a bad ' +
        'sign, only as less evidence. Keep logging through an outage and your results, tilt, and ' +
        'ratings still count in full.'),
    ),
    h('div', null,
      h('div', { style: { fontSize: '12.5px', fontWeight: '600', marginBottom: '6px' } }, 'Training-load model'),
      h('div', { class: 'hint', style: { lineHeight: '1.6' } },
        'Recent volume is compared against YOUR OWN norm — a stable 10-games-a-day rhythm is habit, ' +
        'not risk; only surging above your usual (or a genuine acute:chronic ratio spike) costs ' +
        'points. The ratio is a workload trend observation, not a validated burnout predictor.'),
    ),
    h('div', null,
      h('div', { style: { fontSize: '12.5px', fontWeight: '600', marginBottom: '6px' } }, 'Your own baselines'),
      h('div', { class: 'hint', style: { lineHeight: '1.6' } },
        'Per-10-minute stats (elims, deaths, damage, healing) are compared per hero — and per account, ' +
        'so an alt’s lobbies never skew your main — against your own rolling history, never against ' +
        'other players. A decline only counts once it is sustained across enough games (one long ' +
        'session qualifies); a single bad game never fires it. Heroes you’re still learning (first ' +
        'dozen games) are exempt — early games there don’t count against you.'),
    ),
    h('div', null,
      h('div', { style: { fontSize: '12.5px', fontWeight: '600', marginBottom: '6px' } }, 'Improvement-target dampener'),
      h('div', { class: 'hint', style: { lineHeight: '1.6' } },
        'Practicing something deliberately makes you temporarily worse — that’s normal. When you’re ' +
        'actively hitting your improvement targets (graded on the Review screen), a results dip is ' +
        'softened — unless your tilt is clearly elevated, which voids the benefit of the doubt.'),
    ),
    h('div', null,
      h('div', { style: { fontSize: '12.5px', fontWeight: '600', marginBottom: '6px' } }, 'The supercompensation model'),
      h('div', { style: { display: 'flex', gap: '14px', alignItems: 'center', flexWrap: 'wrap' } },
        supercompensationSchematic(),
        h('div', { class: 'hint', style: { flex: '1', minWidth: '190px', lineHeight: '1.5' } },
          'Training tires you (dip), then rest lifts you above your old baseline (rebound). Grinding ' +
          'without recovery keeps you stuck in the dip — and resting past the rebound decays it back ' +
          'down (rust). Greyed columns on the trend chart are days you didn’t play.'),
      ),
    ),
    h('div', null,
      h('div', { style: { fontSize: '12.5px', fontWeight: '600', marginBottom: '6px' } }, 'Confidence levels'),
      h('div', { class: 'hint', style: { lineHeight: '1.6' } },
        'Confidence now reflects the coverage of the objective inputs first — how many recent games ' +
        'carry real stats, whether the winrate sample is big enough, and whether one account ' +
        'dominates the window. A stats-rich tracked history reaches high confidence without any ' +
        'mental logging; at low confidence the crisp score is hidden so it never overclaims. ' +
        'Running on manual logs alone caps confidence at medium, whatever your mental-log coverage — ' +
        'high confidence is something only live stats can buy.'),
    ),
    h('div', null,
      h('div', { style: { fontSize: '12.5px', fontWeight: '600', marginBottom: '6px' } }, 'Honesty note'),
      h('div', { class: 'hint', style: { lineHeight: '1.6' } },
        'Readiness is an evidence-informed wellness heuristic borrowed from sports training theory — ' +
        'not a medical or diagnostic tool. It also cannot tell external causes apart from fatigue: a ' +
        'balance patch nerfing your hero looks like a decline too. Treat it as a nudge, and trust ' +
        'your own read.'),
    ),
    h('div', { style: { display: 'flex', justifyContent: 'flex-end' } }, button('Close', { variant: 'ghost', onClick: close })),
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

function loadCard(r: ReadinessSummary): HTMLElement {
  const l = r.load;
  return card({ title: 'Training load', sub: 'across all your accounts (fatigue is per-person)' },
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

function chartCard(r: ReadinessSummary): HTMLElement {
  return card({ title: 'Readiness trend', sub: 'last 3 weeks · higher = fresher' },
    readinessChart(r.trend),
  );
}

function honestyCard(): HTMLElement {
  return card({ title: 'How to read this', variant: 'plain' },
    h('div', { class: 'hint', style: { lineHeight: '1.6' } },
      'Readiness is an evidence-informed wellness heuristic borrowed from sports training theory — not a medical or diagnostic tool. It leans on your self-reported mental state and your play pattern (games/day, session length, days without a break), because match results alone are a weak fatigue signal. It watches both directions: overtraining (grinding without rest) and undertraining (long layoffs or too few sessions a week to actually improve). Treat it as a nudge, and trust your own read.'),
  );
}

function disabledView(ctx: ViewContext): HTMLElement {
  return h('div', { class: 'view' },
    viewHead('Readiness', 'Training load & recovery'),
    card({ title: 'Readiness coach is off' },
      h('div', { class: 'hint', style: { marginBottom: '6px' } },
        'Turn it on to track training load and get rest recommendations from your history and mental tracking.'),
      readinessSettingsEditor(ctx),
    ),
  );
}
