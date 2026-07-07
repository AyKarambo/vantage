/**
 * The manual-tracking controls shared by the Review screen and the match-detail
 * editor: a 3-way target-grade row (Hit / Partial / Missed) and the mental-flag
 * chip row. Both are pure DOM factories that mutate a caller-owned grades/flags
 * object, so the same markup/keyboard behaviour backs "grade a fresh game" and
 * "edit a previously-graded match" without any duplicate hand-rolled markup.
 */
import { h } from '../dom';
import { commsTone } from '../../../src/core/comms';
import { commsSwitch } from './commsSwitch';
import type { MatchMental, TargetGrade, TargetSummary } from '../../../src/shared/contract';

const GRADES: Array<{ v: TargetGrade; label: string; bg: string; fg: string }> = [
  { v: 'hit', label: 'Hit', bg: 'rgba(87,166,132,0.18)', fg: 'var(--win-text)' },
  { v: 'partial', label: 'Partial', bg: 'rgba(214,162,79,0.18)', fg: 'var(--mid-text)' },
  { v: 'missed', label: 'Missed', bg: 'rgba(209,104,95,0.16)', fg: 'var(--loss-text)' },
];

/**
 * One target's grade row. `initial` pre-selects a grade (the match-detail editor
 * seeds it from the saved review; Review passes `undefined` so it reads as
 * "needs grading"). Returns `{ el, set }` for every branch so the keyboard hook
 * (H/P/M) can drive it. Measured targets are graded the same way as self-rated
 * ones — the app has no auto-scoring source yet, so nothing is read-only here.
 */
export function targetGradeRow(
  t: TargetSummary,
  initial: TargetGrade | undefined,
  onChange: (g: TargetGrade) => void,
): { el: HTMLElement; set: (g: TargetGrade) => void } {
  const control = gradeControl(onChange);
  const el = h('div', { class: 'review-target' },
    h('div', { class: 'row-main', style: { minWidth: '0' } },
      h('div', { style: { fontSize: '13px' } }, t.name),
      h('div', { class: 'mono u-dim', style: { fontSize: '10.5px', marginTop: '2px' } }, t.rule),
    ),
    control.el,
  );
  if (initial !== undefined) control.set(initial);
  return { el, set: control.set };
}

/** A 3-way grade control that starts unselected, tinting the chosen grade. */
function gradeControl(onChange: (g: TargetGrade) => void): { el: HTMLElement; set: (g: TargetGrade) => void } {
  const btns = GRADES.map((o) => h('button', { class: 'segmented-opt' }, o.label));
  const apply = (i: number): void => {
    btns.forEach((b, j) => {
      const on = i === j;
      b.classList.toggle('is-active', on);
      b.style.background = on ? GRADES[j].bg : '';
      b.style.color = on ? GRADES[j].fg : '';
    });
    onChange(GRADES[i].v);
  };
  GRADES.forEach((_o, i) => btns[i].addEventListener('click', () => apply(i)));
  return {
    el: h('div', { class: 'segmented' }, ...btns),
    set: (g) => apply(GRADES.findIndex((o) => o.v === g)),
  };
}

/** The boolean-valued mental flags the binary chips toggle (comms is separate — see below). */
type BoolFlagKey = 'tilt' | 'toxicMates' | 'leaver' | 'leaverMyTeam' | 'leaverEnemyTeam';

const FLAGS: Array<{ label: string; key: BoolFlagKey }> = [
  { label: 'Tilted', key: 'tilt' },
  { label: 'Toxic mate', key: 'toxicMates' },
  { label: 'Leaver — my team', key: 'leaverMyTeam' },
  { label: 'Leaver — enemy', key: 'leaverEnemyTeam' },
];

/**
 * The mental-flag chips + the three-state comms switch, seeded from (and
 * toggling) the caller's `flags`. Comms is the full Positive / Banter / Abusive
 * tone (the same {@link commsSwitch} the log card uses), reading through
 * `commsTone` so a legacy `positiveComms`/`comms:'positive'` record shows
 * selected and clearing the legacy boolean whenever it writes, so the tone stays
 * the single source of truth. Shared by the match-detail editor and Review.
 */
export function mentalFlagsRow(flags: MatchMental): HTMLElement {
  return h('div', { class: 'stack', style: { gap: '10px' } },
    h('div', { class: 'review-flags' }, ...FLAGS.map((f) => flagChip(f.label, flags, f.key))),
    h('div', null,
      h('div', { class: 'field-label', style: { marginBottom: '6px' } }, 'Comms'),
      commsSwitch({
        get: () => commsTone(flags) ?? null,
        set: (t) => {
          if (t) flags.comms = t;
          else delete flags.comms;
          delete flags.positiveComms; // the tone is authoritative from here on
        },
      }),
    ),
  );
}

function flagChip(label: string, flags: MatchMental, key: BoolFlagKey): HTMLElement {
  const btn = h('button', {
    class: 'chip',
    on: { click: () => { flags[key] = !flags[key]; btn.classList.toggle('is-on', Boolean(flags[key])); } },
  }, label);
  if (flags[key]) btn.classList.add('is-on');
  return btn;
}
