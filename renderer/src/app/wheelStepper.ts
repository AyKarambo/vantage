/**
 * Mouse-wheel + Shift-coarse stepper for a numeric field whose step size depends
 * on runtime state (the measured-target threshold: ±1 for counts, ±250 for
 * damage/10, …). Generalizes the log-match wheel nudge — the step is supplied per
 * tick, Shift multiplies it by COARSE_FACTOR, and the value clamps at `min`.
 * `passive:false` + preventDefault so the page never scrolls while the pointer is
 * over the field.
 */
import { COARSE_FACTOR } from '../../../src/core/targets';

export interface StepperOpts {
  /** The base step for the current stat, read live on each tick. */
  step: () => number;
  /** Called with the new value string after each adjustment. */
  onChange: (value: string) => void;
  /** Lower clamp (default 0). */
  min?: number;
}

export function attachStepper(el: HTMLInputElement, opts: StepperOpts): void {
  const min = opts.min ?? 0;
  el.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const step = opts.step() * (e.shiftKey ? COARSE_FACTOR : 1);
      const dir = e.deltaY < 0 ? 1 : -1;
      // Round to one decimal so KDA's 0.1 step doesn't accumulate float drift;
      // integer stats round to integers naturally.
      const raw = Math.max(min, (Number(el.value) || 0) + step * dir);
      const next = String(Math.round(raw * 10) / 10);
      el.value = next;
      opts.onChange(next);
    },
    { passive: false },
  );
}

/**
 * The simple ±1-per-tick nudge for a signed numeric text field — shared by the
 * log-match SR/% inputs and the match-detail editor so the two surfaces can't
 * drift. No lower clamp (SR deltas and rank-protection % can go negative).
 * `passive:false` + preventDefault so the modal never scrolls under the pointer.
 */
export function attachWheelNudge(el: HTMLInputElement, get: () => string, set: (v: string) => void): void {
  el.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const next = String((Number(get()) || 0) + (e.deltaY < 0 ? 1 : -1));
      set(next);
      el.value = next;
    },
    { passive: false },
  );
}
