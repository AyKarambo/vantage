/**
 * The skill-rating entry controls shared by the quick-log card and the
 * match-detail editor: the Change / Set-current mode toggle, the signed SR-%
 * input, and the tier/division/% rank picker. Extracted so the two match-entry
 * surfaces render (and word) SR entry identically and can't drift again —
 * what each surface *does* with the values (re-anchor vs back-compute) stays
 * the caller's business.
 */
import { h } from '../dom';
import { segmented, select } from './primitives';
import { attachWheelNudge } from './wheelStepper';
import { TIERS } from '../../../src/core/rank';
import type { Result } from '../../../src/shared/contract';

/** The SR-entry mode: nudge the change (±%) or set the current rank outright. */
export type SrMode = 'change' | 'set-current';

/**
 * The SR-% change to pre-fill for a result — a starting point the player fine-tunes
 * with the wheel, since GEP never reports SR. Win/Loss suggest ±25 (a typical
 * competitive swing); a Draw suggests no change. Shared by every SR-entry surface
 * (quick log, match editor, Review) so the suggestion can't drift between them.
 */
export function suggestedSrDelta(result: Result): string {
  return result === 'Win' ? '25' : result === 'Loss' ? '-25' : '0';
}

/** Divisions high→low for the rank picker (5 = lowest band, 1 = highest). */
const DIVISIONS = [5, 4, 3, 2, 1];

/** The Change (±%) / Set current rank segmented toggle. */
export function srModeToggle(value: SrMode, onChange: (v: SrMode) => void): HTMLElement {
  return segmented<SrMode>({
    options: [{ value: 'change', label: 'Change (±%)' }, { value: 'set-current', label: 'Set current rank' }],
    value,
    onChange,
    fill: true,
  });
}

/** A signed number input styled like the rest of the form, with the ±1 wheel nudge. */
function nudgedInput(value: string, placeholder: string, onChange: (v: string) => void): HTMLInputElement {
  const el = h('input', {
    class: 'vt-input mono', type: 'number', step: '1', value, placeholder,
    on: { input: (e) => onChange((e.target as HTMLInputElement).value) },
  }) as HTMLInputElement;
  attachWheelNudge(el, () => el.value, onChange);
  return el;
}

/** The Change-mode signed SR-% input (blank allowed; the caller interprets it). */
export function srDeltaInput(value: string, onChange: (v: string) => void): HTMLInputElement {
  return nudgedInput(value, 'e.g. +22 or -19', onChange);
}

export interface RankPickerOpts {
  tier: string;
  division: number;
  /** Percent within the division as entered text ('' = unset; negative = protected). */
  pct: string;
  onTier: (tier: string) => void;
  onDivision: (division: number) => void;
  onPct: (pct: string) => void;
}

/** The Set-current-mode tier / division / % picker (wheel-nudged % field). */
export function rankPicker(opts: RankPickerOpts): HTMLElement {
  return h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
    select(TIERS.map((t) => ({ value: t, label: t })), opts.tier, opts.onTier),
    select(DIVISIONS.map((d) => ({ value: String(d), label: `Div ${d}` })), String(opts.division),
      (v) => opts.onDivision(Number(v))),
    nudgedInput(opts.pct, 'e.g. 40, or -19 if protected', opts.onPct),
  );
}
