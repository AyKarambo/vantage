/**
 * Readiness / training-load coach screen. Turns the readiness verdict into a
 * clear traffic-light read + rest recommendation, the contributing signals, the
 * training-load numbers, a trend chart, and — importantly — an honest note that
 * this is a wellness heuristic, not a diagnosis.
 */
import { h } from '../dom';
import type { ReadinessBand, ReadinessSignal, ReadinessSummary } from '../../../src/shared/contract';
import { PALETTE } from '../theme';
import { card, statBox } from '../components/primitives';
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

export function readiness(ctx: ViewContext): HTMLElement {
  if (!ctx.data.readinessSettings.enabled) return disabledView(ctx);

  const r = ctx.data.readiness;
  return h('div', { class: 'view' },
    viewHead('Readiness', 'Training load & recovery — a wellness heuristic, not a diagnosis'),
    h('div', { class: 'grid-2' }, verdictCard(ctx), whyCard(r)),
    loadCard(r),
    chartCard(r),
    honestyCard(),
    card({ title: 'Settings' }, readinessSettingsEditor(ctx)),
  );
}

/** Bands where training load is the concern — worth pointing at the break reminder. */
const BREAK_REMINDER_BANDS: ReadinessBand[] = ['loaded', 'in-the-hole'];

function verdictCard(ctx: ViewContext): HTMLElement {
  const r = ctx.data.readiness;
  const meta = BAND[r.band];
  // When confidence is low we deliberately suppress the crisp number so it never
  // reads as more certain than it is.
  const showScore = r.score !== null && r.confidence !== 'low';
  return card({ title: 'Verdict' },
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
      `Confidence: ${r.confidence}${r.confidence === 'low' ? ' — log your mental state after games to sharpen this' : ''}`),
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
    h('div', { style: { display: 'flex', gap: '14px', alignItems: 'center', marginTop: '12px', flexWrap: 'wrap' } },
      supercompensationSchematic(),
      h('div', { class: 'hint', style: { flex: '1', minWidth: '190px', lineHeight: '1.5' } },
        'The supercompensation idea: training tires you (dip), then rest lifts you above your old baseline (rebound). Grinding without recovery keeps you stuck in the dip — and resting past the rebound decays it back down (rust). Greyed columns above are days you didn’t play.'),
    ),
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
