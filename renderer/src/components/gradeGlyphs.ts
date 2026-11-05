/**
 * Target-execution visuals for Training (issue #342): Hit / Partial / Miss as
 * small symbols in the win / draw / loss colours — the training counterpart of
 * the W / L / D result chip. Shape carries the grade as well as colour (✓ ◐ ✕),
 * so it reads without the colour scheme; the words live in the tooltips.
 */
import { h } from '../dom';
import type { TargetGrade } from '../../../src/shared/contract';
import type { PillState } from './primitives';

export const GRADE_GLYPH: Record<TargetGrade, { glyph: string; label: string; state: PillState }> = {
  hit: { glyph: '✓', label: 'Hit', state: 'win' },
  partial: { glyph: '◐', label: 'Partial', state: 'draw' },
  missed: { glyph: '✕', label: 'Miss', state: 'loss' },
};

/** One focus target's grade, with the target's name for the tooltip. */
export interface GradedTarget {
  name: string;
  grade: TargetGrade;
}

/** Most dots a many-target lead cell draws (3 × 3); the tooltip still lists every target. */
const MAX_DOTS = 9;

/**
 * A training row's lead cell, same 38px footprint as the W/L/D chip: one
 * target → one big symbol chip; two or three → a row of small symbols; four or
 * more → a block of coloured dots; nothing graded yet → a dashed empty chip.
 */
export function gradeLeadCell(graded: GradedTarget[], ungradedTitle: string): HTMLElement {
  if (!graded.length) {
    return h('div', { class: 'match-result is-ungraded', title: ungradedTitle }, '–');
  }
  const title = graded.map((g) => `${g.name}: ${GRADE_GLYPH[g.grade].label}`).join('\n');
  if (graded.length === 1) {
    const spec = GRADE_GLYPH[graded[0].grade];
    return h('div', { class: `match-result grade-lead is-${spec.state}`, title, 'aria-label': spec.label }, spec.glyph);
  }
  if (graded.length <= 3) {
    return h('div', { class: 'match-result grade-lead grade-lead--multi', title },
      ...graded.map((g) => h('span', { class: `grade-g is-${GRADE_GLYPH[g.grade].state}` }, GRADE_GLYPH[g.grade].glyph)));
  }
  return h('div', { class: 'match-result grade-lead grade-lead--dots', title },
    ...graded.slice(0, MAX_DOTS).map((g) => h('span', { class: `grade-dot is-${GRADE_GLYPH[g.grade].state}` })));
}

/** A thin Hit / Partial / Miss split bar for a training header; null with no grades. */
export function gradeSplitBar(c: { hits: number; partials: number; misses: number }): HTMLElement | null {
  const total = c.hits + c.partials + c.misses;
  if (!total) return null;
  const seg = (n: number, state: PillState): HTMLElement | null =>
    n ? h('span', { class: `grade-split-seg is-${state}`, style: { flexGrow: String(n) } }) : null;
  return h('span', {
    class: 'grade-split',
    title: `${c.hits} Hit · ${c.partials} Partial · ${c.misses} Miss`,
  }, seg(c.hits, 'win'), seg(c.partials, 'draw'), seg(c.misses, 'loss'));
}

/**
 * The 0-100 self-rated performance as a small meter: a Loss → Draw → Win track
 * with a marker (100 = win colour, 50 = draw, 0 = loss). The number is only in
 * the tooltip — the position and colour are the read.
 */
export function performanceMeter(value: number): HTMLElement {
  const v = Math.max(0, Math.min(100, value));
  const toward = v >= 50 ? 'var(--win-text)' : 'var(--loss-text)';
  const strength = Math.round(Math.abs(v - 50) * 2);
  return h('span', { class: 'perf-meter', title: `Self-rated performance ${v}/100`, role: 'img', 'aria-label': `Performance ${v} of 100` },
    h('span', {
      class: 'perf-meter-dot',
      style: {
        left: `${v}%`,
        background: `color-mix(in srgb, ${toward} ${strength}%, var(--muted))`,
      },
    }));
}
