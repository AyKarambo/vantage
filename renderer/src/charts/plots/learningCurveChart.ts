/**
 * Focus Trend chart — the per-target learning J-curve, dependency-free SVG in the
 * house grammar (cloned from {@link ./readinessChart}). Plots the rolling winrate
 * over the games SINCE you flagged a target against your REAL pre-flag baseline,
 * wrapped in a Wilson uncertainty band that is fat when few games back it.
 *
 * The design is deliberately un-alarming: a dip is just the hero line dropping
 * under a neutral dashed reference — never tinted red. The only emotional colour
 * is the win-green payoff wedge, and it fills ONLY where the rolling winrate has
 * climbed back at or above where you started. See ./learningCurve (core) for the
 * honesty guarantees behind the numbers.
 */
import { h } from '../../dom';
import type { LearningCurvePoint, TargetLearningCurve } from '../../../../src/shared/contract';
import { MIN_RENDER, MIN_VERDICT, ROLL_WINDOW } from '../../../../src/core/targets';
import { pct } from '../../format';
import { PALETTE } from '../../theme';
import { svgEl, svgRoot, svgText } from '../svg';
import { tooltipLayer } from '../tooltip';
import type { ChartTableColumn, ChartTableRow } from '../../components/chartCard';

const W = 720, H = 190;
const padL = 34, padR = 16, padT = 14, padB = 30;
const bot = H - padB, top = padT, plotH = bot - top;

/** Raw-outcome rug colour — win-green / loss-red / muted draw. */
const RUG_COLOR: Record<LearningCurvePoint['result'], string> = {
  Win: PALETTE.win,
  Loss: PALETTE.loss,
  Draw: PALETTE.muted,
};

/** A non-null rolling point, resolved to screen coordinates. */
interface Plotted {
  index: number;
  x: number;
  yRoll: number;
  yHi: number;
  yLo: number;
}

/** Short "Mon D" date for the hover tooltip (calendar date lives here only). */
const shortDate = (ts: number): string =>
  new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/**
 * The Focus Trend chart. Renders one of three states by how many decided games
 * have accrued since the flag:
 *  - < MIN_RENDER: no data chart — a small illustrative J-curve schematic.
 *  - MIN_RENDER..MIN_VERDICT: the real chart with a desaturated hero line.
 *  - ≥ MIN_VERDICT: the full-confidence chart.
 */
export function learningCurveChart(curve: TargetLearningCurve): HTMLElement {
  const wrap = h('div', { class: 'chart-wrap' });

  // Gathering — too few decided games to draw an honest line. Show the teaching
  // schematic (what a learning curve looks like) plus how far along you are.
  if (curve.decidedSince < MIN_RENDER) {
    wrap.append(
      h('div', { style: { display: 'flex', justifyContent: 'center', padding: '10px 0 4px' } }, practiceJSchematic()),
      h('div', { class: 'hint', style: { textAlign: 'center', marginTop: '2px' } },
        `${curve.decidedSince} of ${MIN_VERDICT} games — keep hitting it and the trend will draw in.`),
    );
    return wrap;
  }

  const provisional = curve.decidedSince < MIN_VERDICT;
  const heroOpacity = provisional ? 0.5 : 1;
  const s = svgRoot(W, H);
  const n = curve.points.length;
  const xAt = (i: number): number => padL + (n <= 1 ? 0 : (i / (n - 1)) * (W - padL - padR));
  const yFrac = (f: number): number => bot - f * plotH;

  // 1. Gridlines 0/50/100% + left % axis (house style; 50% dashed).
  for (const g of [0, 0.5, 1]) {
    const y = yFrac(g);
    s.appendChild(svgEl('line', { x1: padL, y1: y, x2: W - padR, y2: y, stroke: PALETTE.grid, 'stroke-dasharray': g === 0.5 ? '4 4' : '0' }));
    s.appendChild(svgText(padL - 6, y + 4, `${Math.round(g * 100)}%`, { anchor: 'end', mono: true, fill: PALETTE.dim }));
  }

  // 2. Baseline reference — neutral cyan dashed line at your pre-flag winrate.
  //    Omitted entirely when there is no honest baseline to compare against.
  const yBase = curve.baseline != null ? yFrac(curve.baseline) : null;
  if (curve.baseline != null && yBase != null) {
    s.appendChild(svgEl('line', {
      x1: padL, y1: yBase, x2: W - padR, y2: yBase,
      stroke: PALETTE.info, 'stroke-width': 1.5, 'stroke-dasharray': '6 4',
    }));
    s.appendChild(svgText(W - padR, yBase - 5, `before focus · ${pct(curve.baseline)}`, { anchor: 'end', size: 9, fill: PALETTE.dim }));
  }

  // Group the rolling points into contiguous runs, skipping the null-roll gaps.
  const runs: Plotted[][] = [];
  let cur: Plotted[] = [];
  curve.points.forEach((p, i) => {
    if (p.roll == null) {
      if (cur.length) { runs.push(cur); cur = []; }
      return;
    }
    cur.push({ index: p.index, x: xAt(i), yRoll: yFrac(p.roll), yHi: yFrac(p.ciHigh), yLo: yFrac(p.ciLow) });
  });
  if (cur.length) runs.push(cur);

  // 3. Wilson band — filled ciHigh→ciLow envelope per run, no stroke. The primary
  //    honesty device: fat where few games back the point, narrowing as they add up.
  for (const run of runs) {
    if (run.length < 2) continue;
    const highs = run.map((p) => `${p.x.toFixed(1)} ${p.yHi.toFixed(1)}`);
    const lows = run.map((p) => `${p.x.toFixed(1)} ${p.yLo.toFixed(1)}`).reverse();
    s.appendChild(svgEl('path', {
      d: `M${highs.join(' L')} L${lows.join(' L')} Z`,
      fill: 'rgba(124,108,245,0.14)', stroke: 'none',
    }));
  }

  // 4. Payoff wedge — the only emotional colour. Win-green fill in the region
  //    between the rolling line and the baseline, ONLY where roll ≥ baseline.
  //    Below-baseline stays untinted (clamp keeps it flush to the baseline).
  if (curve.baseline != null && yBase != null) {
    for (const run of runs) {
      if (run.length < 2) continue;
      const tops = run.map((p) => `${p.x.toFixed(1)} ${Math.min(p.yRoll, yBase).toFixed(1)}`);
      // Scheme-aware win colour at low opacity (the house zone-tint pattern), so
      // the wedge tracks the same "winning" hue as the rug's win ticks.
      s.appendChild(svgEl('path', {
        d: `M${run[0].x.toFixed(1)} ${yBase.toFixed(1)} L${tops.join(' L')} L${run[run.length - 1].x.toFixed(1)} ${yBase.toFixed(1)} Z`,
        fill: PALETTE.win, 'fill-opacity': 0.12, stroke: 'none',
      }));
    }
  }

  // 5. Raw-outcome rug — one short tick per game along the bottom axis (streak &
  //    volume without a jagged 0/100 line).
  curve.points.forEach((p, i) => {
    const x = xAt(i);
    s.appendChild(svgEl('line', { x1: x, y1: bot - 5, x2: x, y2: bot, stroke: RUG_COLOR[p.result], 'stroke-width': 1.5, opacity: 0.4 }));
  });

  // 6. Rolling hero line — accent, rounded, desaturated while provisional.
  for (const run of runs) {
    if (run.length < 2) continue;
    s.appendChild(svgEl('path', {
      d: run.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.yRoll.toFixed(1)}`).join(' '),
      fill: 'none', stroke: PALETTE.accent, 'stroke-width': 2.5,
      'stroke-linejoin': 'round', 'stroke-linecap': 'round', opacity: heroOpacity,
    }));
  }

  // 6b. Execution overlay — the rolling HIT-RATE (how often you're hitting the target
  //     lately), an amber dashed line. It usually rises BEFORE winrate does, so a
  //     rising amber line during a dip is the honest "practice is landing" cue.
  const hitRuns: Array<Array<{ x: number; y: number }>> = [];
  let hitRun: Array<{ x: number; y: number }> = [];
  curve.points.forEach((p, i) => {
    if (p.hitRoll == null) {
      if (hitRun.length) { hitRuns.push(hitRun); hitRun = []; }
      return;
    }
    hitRun.push({ x: xAt(i), y: yFrac(p.hitRoll) });
  });
  if (hitRun.length) hitRuns.push(hitRun);
  const hasExec = hitRuns.some((r) => r.length >= 2);
  for (const hr of hitRuns) {
    if (hr.length < 2) continue;
    s.appendChild(svgEl('path', {
      d: hr.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' '),
      fill: 'none', stroke: PALETTE.mid, 'stroke-width': 2, 'stroke-dasharray': '5 3',
      'stroke-linejoin': 'round', 'stroke-linecap': 'round', opacity: heroOpacity,
    }));
  }

  // Legend — the two lines, shown only once the execution line has data.
  if (hasExec) {
    const ly = top + 5;
    s.appendChild(svgEl('line', { x1: padL + 4, y1: ly, x2: padL + 20, y2: ly, stroke: PALETTE.accent, 'stroke-width': 2.5 }));
    s.appendChild(svgText(padL + 24, ly + 3, 'winrate', { anchor: 'start', size: 8.5, fill: PALETTE.dim }));
    s.appendChild(svgEl('line', { x1: padL + 74, y1: ly, x2: padL + 92, y2: ly, stroke: PALETTE.mid, 'stroke-width': 2, 'stroke-dasharray': '5 3' }));
    s.appendChild(svgText(padL + 96, ly + 3, 'hit-rate', { anchor: 'start', size: 8.5, fill: PALETTE.dim }));
  }

  // 7. Rebound marker — a faint vertical line where the rolling winrate sustainably
  //    crossed back over baseline.
  if (curve.reboundIndex != null) {
    const ri = curve.points.findIndex((p) => p.index === curve.reboundIndex);
    if (ri >= 0) {
      const x = xAt(ri);
      s.appendChild(svgEl('line', { x1: x, y1: top, x2: x, y2: bot, stroke: PALETTE.grid, 'stroke-width': 1 }));
      s.appendChild(svgText(x, top + 8, 'back above baseline', { anchor: x > W / 2 ? 'end' : 'start', size: 8, fill: PALETTE.muted }));
    }
  }

  // Dots + generous invisible hit targets on every rolling point → shared tooltip.
  const tips = tooltipLayer(wrap);
  curve.points.forEach((p, i) => {
    if (p.roll == null) return;
    const cx = xAt(i), cy = yFrac(p.roll);
    s.appendChild(svgEl('circle', { cx, cy, r: 3, fill: PALETTE.accentBright, opacity: heroOpacity }));
    const hit = svgEl('circle', { cx, cy, r: 11, fill: 'transparent' });
    hit.style.cursor = 'pointer';
    tips.attach(hit, tooltipFor(p, curve.baseline));
    s.appendChild(hit);
  });

  // X axis — games-since-flag index (g1, g5, g10 … last), stepped ~1/8.
  const step = Math.max(1, Math.ceil(n / 8));
  const last = n - 1;
  curve.points.forEach((p, i) => {
    const stepped = i % step === 0 && last - i >= step / 2;
    if (stepped || i === last) s.appendChild(svgText(xAt(i), bot + 13, `g${p.index}`, { size: 9 }));
  });
  s.appendChild(svgText(padL + (W - padL - padR) / 2, H - 3, 'games since you started focusing this', { size: 9, fill: PALETTE.dim }));

  // Provisional stamp — this is a read-in-progress, not a verdict yet.
  if (provisional) {
    s.appendChild(svgText(W - padR, top + 8, `${curve.decidedSince} of ~${MIN_VERDICT} games`, { anchor: 'end', size: 9, fill: PALETTE.dim }));
  }

  wrap.append(s, tips.tip);
  return wrap;
}

/** Hover copy for one rolling point, e.g. "Jul 4 · game 14 · rolling 55% …". */
function tooltipFor(p: LearningCurvePoint, baseline: number | null): string {
  const grade = p.grade ? `, target ${p.grade}` : '';
  const vsBase = baseline != null ? ` · vs before focus ${pct(baseline)}` : '';
  const exec = p.hitRoll != null ? ` · hit-rate ${pct(p.hitRoll)}` : '';
  return `${shortDate(p.timestamp)} · game ${p.index} · rolling ${pct(p.roll ?? 0)} (${p.rollDecided} of ${ROLL_WINDOW} decided)`
    + ` · 95% CI ${pct(p.ciLow)}–${pct(p.ciHigh)}${vsBase}${exec} · this game: ${p.result}${grade}`;
}

/**
 * A small, purely illustrative learning J-curve — dashed baseline → a practice
 * dip → an arch back above where you started. Its own schematic (NOT readiness's
 * fatigue/rust supercompensation curve): the words here are "practice dip" and
 * "paying off", framed as expected, never as decline.
 */
export function practiceJSchematic(): SVGSVGElement {
  const w = 260, hgt = 92, base = 46;
  const s = svgRoot(w, hgt);
  // svgRoot is fluid (width:100%); cap this fixed illustration at its design size
  // so it can't balloon to its flex container (same guard as readiness's schematic).
  s.style.width = `${w}px`;
  s.style.maxWidth = '100%';
  s.style.height = 'auto';
  s.appendChild(svgEl('line', { x1: 8, y1: base, x2: w - 8, y2: base, stroke: PALETTE.grid, 'stroke-dasharray': '3 3' }));
  s.appendChild(svgText(10, base - 4, 'before focus', { anchor: 'start', size: 8, fill: PALETTE.dim }));
  // Baseline → dip below → rebound into an arch above baseline (the J-curve).
  s.appendChild(svgEl('path', {
    d: 'M8,46 L36,46 C56,50 66,74 92,74 C120,74 132,40 168,32 C196,26 224,28 252,30',
    fill: 'none', stroke: PALETTE.accentBright, 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
  }));
  s.appendChild(svgText(92, 88, 'practice dip', { anchor: 'middle', size: 8, fill: PALETTE.muted }));
  s.appendChild(svgText(212, 22, 'paying off', { anchor: 'middle', size: 8, fill: PALETTE.win }));
  return s;
}

/** The Chart⇄Table alternative: one row per game since the flag. */
export const LEARNING_CURVE_COLUMNS: ChartTableColumn[] = [
  { key: 'game', label: 'game #' },
  { key: 'date', label: 'date' },
  { key: 'result', label: 'result' },
  { key: 'grade', label: 'grade' },
  { key: 'roll', label: 'rolling %' },
  { key: 'ci', label: 'CI' },
  { key: 'hit', label: 'hit-rate' },
];

/** Table rows for {@link learningCurveChart}'s text alternative (accessibility). */
export function learningCurveRows(curve: TargetLearningCurve): ChartTableRow[] {
  return curve.points.map((p) => ({
    game: p.index,
    date: new Date(p.timestamp).toISOString().slice(0, 10),
    result: p.result,
    grade: p.grade ?? '–',
    roll: p.roll != null ? pct(p.roll) : '–',
    ci: p.roll != null ? `${pct(p.ciLow)}–${pct(p.ciHigh)}` : '–',
    hit: p.hitRoll != null ? pct(p.hitRoll) : '–',
  }));
}
