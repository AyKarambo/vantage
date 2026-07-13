/**
 * Focus Trend surfaces for a target — the collapsed-row phase chip, the opt-in
 * disclosure toggle, and the expanded panel. The panel reframes a post-flag dip
 * as the expected cost of practising something new (a learning J-curve), judged
 * by the rebound rather than the first few games. See ../charts/plots/learningCurveChart
 * for the chart and ../../src/core/targets/learningCurve for the numbers.
 *
 * The disclosure is a persistent local toggle: clicking it mutates its own DOM in
 * place and NEVER notifies the store, so a background store-notify re-render can't
 * tear the button out from under the click (the mid-press swallow, PR #36). The
 * open/closed choice is remembered per target id so it also survives a full
 * library re-render (a refresh that rebuilds the row re-opens it).
 */
import { h } from '../dom';
import type { LearningPhase, TargetLearningCurve, TargetSummary } from '../../../src/shared/contract';
import { MIN_VERDICT } from '../../../src/core/targets';
import { pct } from '../format';
import { PALETTE } from '../theme';
import { button, statBox } from './primitives';
import { chartCard } from './chartCard';
import { learningCurveChart, learningCurveRows, LEARNING_CURVE_COLUMNS } from '../charts/plots';
import { openFocusTrendGuide } from '../app/focusTrendGuide';

/** Header + sub, verbatim from the spec — the panel's framing. */
const HEADER = 'Since you started focusing this';
const SUB = 'Winrate often dips while a new habit clicks — judge it by the rebound, not the first few games.';
/** The load-bearing reframe — a dip is doing the new thing on purpose, not getting worse. */
const REFRAME = 'A lower winrate right after you flag something usually means you’re doing the new thing on purpose — not that you got worse.';
/** Shown in building/climbing — trough reassurance. */
const TROUGH = 'Dips here are normal — focusing something new usually costs a few games before it pays off. Keep hitting it.';
/** The always-on honesty footnote. */
const FOOTNOTE = 'Rolling winrate over your last 10 decided games since you flagged this. Shaded band = 95% uncertainty — wide when you’ve played few games. Draws excluded; compared to your form over the 20 games before you flagged it. Your form moves for many reasons — this shows the trend, not proof this target caused it.';

/** Per-phase chip colour + copy. Colour anchors to trajectory; copy is verbatim.
 *  Deliberately never red — the worst state ("building") is framed as expected. */
const PHASE_META: Record<LearningPhase, { color: string; label: (c: TargetLearningCurve) => string }> = {
  gathering: { color: PALETTE.muted, label: (c) => `Gathering · ${c.decidedSince}/${MIN_VERDICT}` },
  'no-baseline': { color: PALETTE.muted, label: () => 'New focus — no before-baseline to compare yet' },
  building: { color: PALETTE.accentBright, label: () => 'Building — the practice dip (expected)' },
  climbing: { color: PALETTE.accentBright, label: () => 'Climbing back' },
  'paying-off': { color: PALETTE.win, label: () => 'Paying off ↑ above where you started' },
  steady: { color: PALETTE.text, label: () => 'Holding steady' },
};

/** The collapsed-row phase chip — a static bordered pill tinted by trajectory. */
export function phaseChip(curve: TargetLearningCurve): HTMLElement {
  const meta = PHASE_META[curve.phase];
  return h('span', {
    class: 'badge',
    style: { color: meta.color, border: `1px solid ${meta.color}`, background: 'transparent', whiteSpace: 'nowrap' },
    title: REFRAME,
  }, meta.label(curve));
}

/** Module-level per-target open state, so a full library re-render re-opens the
 *  panels the user had expanded (the toggle itself never notifies the store). */
const expandedTrends = new Set<string>();

/**
 * The opt-in disclosure for a live target. Returns the ghost toggle to drop into
 * the row actions plus the panel to append below the row, already wired to a
 * local in-place toggle. Returns null for targets with no learning model
 * (archived/empty) — they get no trend surface.
 */
export function focusTrendDisclosure(t: TargetSummary): { toggle: HTMLButtonElement; panel: HTMLElement } | null {
  const curve = t.learning;
  if (!curve) return null;

  let open = expandedTrends.has(t.id);
  const panel = targetTrend(curve);
  panel.style.display = open ? '' : 'none';

  const chev = h('span', {
    style: { display: 'inline-block', transition: 'transform 120ms var(--ease, ease)', fontSize: '10px' },
  }, '▸');
  const label = h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '5px' } }, chev, 'Focus trend');

  const apply = (): void => {
    panel.style.display = open ? '' : 'none';
    chev.style.transform = open ? 'rotate(90deg)' : 'rotate(0deg)';
    toggle.setAttribute('aria-expanded', String(open));
  };
  const toggle = button(label, {
    variant: 'ghost',
    title: 'Show the winrate trend since you flagged this',
    // Local-only: mutate our own nodes, never touch the store → no re-render can
    // land between this click's down and up and swallow it.
    onClick: () => {
      open = !open;
      if (open) expandedTrends.add(t.id); else expandedTrends.delete(t.id);
      apply();
    },
  });
  apply();
  return { toggle, panel };
}

/** The expanded Focus Trend panel: before/after tiles, the reframe, the chart
 *  (with a free Chart⇄Table toggle), and the honesty footnote. */
export function targetTrend(curve: TargetLearningCurve): HTMLElement {
  const lastRoll = [...curve.points].reverse().find((p) => p.roll != null);
  const beforeLabel = curve.baseline != null ? `Before focus · n=${curve.baselineDecided}` : 'Before focus · not enough history yet';
  const recentLabel = lastRoll ? `Recent · CI ${pct(lastRoll.ciLow)}–${pct(lastRoll.ciHigh)}` : 'Recent';
  const showTrough = curve.phase === 'building' || curve.phase === 'climbing';

  return h('div', {
    class: 'focus-trend-panel',
    style: {
      marginTop: '12px', padding: '12px 14px',
      background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
    },
  },
    h('div', { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '10px' } },
      h('div', { style: { fontFamily: 'var(--font-head)', fontSize: '13px', fontWeight: '600' } }, HEADER),
      // Local-only affordance: opening the guide drawer is modal and never notifies
      // the store, so no re-render can land mid-click (the mid-press swallow, PR #36).
      h('button', {
        class: 'inline-link',
        title: 'How to read this chart',
        style: { fontSize: '11.5px', flex: '0 0 auto', whiteSpace: 'nowrap' },
        on: { click: () => openFocusTrendGuide() },
      }, '? How to read this'),
    ),
    h('div', { class: 'hint', style: { marginTop: '3px', lineHeight: '1.5' } }, SUB),
    h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '10px' } },
      statBox(curve.baseline != null ? pct(curve.baseline) : '—', beforeLabel),
      statBox(lastRoll ? pct(lastRoll.roll ?? 0) : '—', recentLabel),
    ),
    // Execution is the leading signal — surface it prominently when it's climbing
    // ahead of winrate (the honest "it's working" cue during a dip).
    curve.execLeads
      ? h('div', {
          style: {
            marginTop: '10px', padding: '8px 10px', borderRadius: 'var(--r-sm)',
            background: 'var(--surface-3, rgba(255,255,255,0.04))', borderLeft: `2px solid ${PALETTE.mid}`,
            color: PALETTE.mid, fontSize: '11.5px', lineHeight: '1.5', fontWeight: '500',
          },
        }, `You’re hitting the target more often lately${curve.execCurrent != null ? ` (${pct(curve.execCurrent)})` : ''} — execution is climbing before winrate does. That’s the sign practice is landing; keep going.`)
      : null,
    h('div', { class: 'hint', style: { marginTop: '10px', lineHeight: '1.5', color: 'var(--muted)' } }, REFRAME),
    showTrough ? h('div', { class: 'hint', style: { marginTop: '8px', lineHeight: '1.5' } }, TROUGH) : null,
    h('div', { class: 'hint', style: { marginTop: '10px', lineHeight: '1.5' } },
      'Purple = winrate (the outcome). Amber dashed = hit-rate — how often you’re hitting the target — which usually climbs first.'),
    h('div', { style: { marginTop: '8px' } },
      chartCard(
        { title: 'Rolling winrate + hit-rate', columns: LEARNING_CURVE_COLUMNS, rows: learningCurveRows(curve) },
        learningCurveChart(curve),
      ),
    ),
    h('div', { class: 'hint', style: { marginTop: '10px', lineHeight: '1.5', fontSize: '10.5px' } }, FOOTNOTE),
  );
}
