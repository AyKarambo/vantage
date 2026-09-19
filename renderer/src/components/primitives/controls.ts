/**
 * Interactive input controls — buttons, segmented switches, and the native
 * select wrapper. Each is a pure factory over its options, self-managing any
 * transient UI state (e.g. the active segment) so callers don't re-render.
 */
import { h } from '../../dom';

type Child = Node | string | number | null | undefined | false;

/**
 * Options for {@link button}; `variant` picks the visual weight, `default` is
 * unstyled. One `primary` per surface (the save/commit action); `danger` for
 * anything that isn't undoable (permanent delete, remove) — never reach for
 * `primary` there, it reads exactly like Save; `soft` for a card-level CTA
 * that isn't the surface's single primary action.
 */
export interface BtnOpts {
  variant?: 'primary' | 'soft' | 'ghost' | 'danger' | 'default';
  onClick?: () => void;
  disabled?: boolean;
  class?: string;
  title?: string;
}

/** Standard clickable button used across every screen's actions. */
export function button(label: Child, o: BtnOpts = {}): HTMLButtonElement {
  const variant = o.variant && o.variant !== 'default' ? ` btn--${o.variant}` : '';
  return h('button', {
    class: `btn${variant}${o.class ? ' ' + o.class : ''}`,
    disabled: o.disabled,
    title: o.title,
    on: o.onClick ? { click: o.onClick } : undefined,
  }, label);
}

/**
 * Options for {@link toggleRow} — a fixed-label boolean setting. Several
 * on/off settings used to be a `chip()` (`../labels`) whose only state cue
 * was a tint, with the actual on/off carried entirely in the label text
 * itself ("Demo data: on" vs "Demo data: off", or worse, asymmetric wording
 * like "✕ keeps Vantage in the tray" vs "✕ quits Vantage") — no shared
 * vocabulary a screen reader's `role=switch`/`aria-checked` could hook onto
 * (K3).
 */
export interface ToggleRowOpts {
  /** Never changes with the state — the switch track alone shows on/off. */
  label: string;
  on: boolean;
  /** Explanatory line under the row, same placement every caller already used with `chip`. */
  hint?: string | Node;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}

/** Options for the bare {@link toggleSwitch} — no label/hint layout, just the control itself. */
export interface ToggleSwitchOpts {
  on: boolean;
  disabled?: boolean;
  /** Read by assistive tech when the switch has no adjacent visible label (K3) — e.g. a header-level toggle like Logs' "Debug detail". */
  ariaLabel?: string;
  onChange: (next: boolean) => void;
}

/**
 * The bare switch control: a real `role="switch"` track (native Space/Enter
 * via the underlying `<button>`, `aria-checked`, a visible focus ring), with
 * no label or hint layout around it — for a compact, inline spot ({@link
 * toggleRow} wraps this for the common full-row case).
 */
export function toggleSwitch(o: ToggleSwitchOpts): HTMLButtonElement {
  const track = h('span', { class: `toggle-switch${o.on ? ' is-on' : ''}` },
    h('span', { class: 'toggle-thumb' }));
  return h('button', {
    class: 'toggle-track',
    role: 'switch',
    'aria-checked': o.on ? 'true' : 'false',
    'aria-label': o.ariaLabel,
    disabled: o.disabled,
    on: o.disabled ? undefined : { click: () => o.onChange(!o.on) },
  }, track);
}

/**
 * A labelled boolean setting: {@link toggleSwitch} beside a label that never
 * rewrites itself, plus an optional hint line underneath (K3). Reserve
 * {@link chip} for filter-style multi-choice or momentary controls; this is
 * for a genuine on/off app setting.
 */
export function toggleRow(o: ToggleRowOpts): HTMLElement {
  return h('div', { class: 'toggle-row' },
    h('div', { class: 'toggle-row-main' },
      h('span', { class: 'toggle-row-label' }, o.label),
      // The label is a sibling, not inside the switch <button> itself, so the
      // button has no text content of its own to derive an accessible name
      // from — pass the same label through explicitly rather than leaving a
      // screen reader with a bare "switch, off/on".
      toggleSwitch({ on: o.on, disabled: o.disabled, ariaLabel: o.label, onChange: o.onChange }),
    ),
    o.hint ? h('div', { class: 'hint', style: { marginTop: '6px' } }, o.hint) : null,
  );
}

/**
 * How long the armed state must have been held before a click can commit it.
 * Without this a double-click lands both the arm AND the commit, so a
 * "two-click confirm" confirms nothing — the single most common mouse gesture
 * in a list would destroy data outright.
 */
const ARM_DWELL_MS = 400;

/** How long the armed state survives untouched before reverting on its own. */
const ARM_TTL_MS = 4000;

/** Options for {@link confirmButton}. */
export interface ConfirmBtnOpts {
  /** Resting label, e.g. `Delete match`. */
  label: string;
  /** Armed label — say what is about to happen, e.g. `Delete permanently?`. */
  confirmLabel: string;
  /**
   * Runs on the confirmed second click. The button disables itself first; call
   * `reset()` to re-enable it (an error path that leaves the row on screen).
   */
  onConfirm: (reset: () => void) => void;
  variant?: BtnOpts['variant'];
  class?: string;
  title?: string;
  /** Tooltip while armed — the place to spell out that this can't be undone. */
  confirmTitle?: string;
}

/**
 * A destructive button that confirms itself in place: the first click swaps it
 * to {@link ConfirmBtnOpts.confirmLabel} in the danger variant, the second one
 * commits. Self-managing like {@link segmented}, so callers never re-render it.
 *
 * Deliberately hard to fire by accident, because the actions behind it are
 * irreversible:
 * - a commit click within {@link ARM_DWELL_MS} of arming is ignored, so a
 *   double-click can't arm-and-commit in one gesture;
 * - keyboard auto-repeat on Enter/Space is suppressed, so holding a key on a
 *   focused button can't do the same;
 * - it disarms on blur, on Escape, and after {@link ARM_TTL_MS}.
 *
 * Escape is stopped from propagating while armed — `openModal` listens on
 * `window` in the bubble phase, so a disarming Escape would otherwise also
 * close the surrounding editor.
 *
 * No `aria-live`: the button's own accessible name changes while it holds
 * focus, which screen readers already announce — a live region on the focused
 * control tends to double-announce or be dropped entirely.
 */
export function confirmButton(o: ConfirmBtnOpts): HTMLButtonElement {
  const variant = o.variant && o.variant !== 'default' ? ` btn--${o.variant}` : '';
  const btn = h('button', {
    class: `btn${variant}${o.class ? ' ' + o.class : ''}`,
    title: o.title,
  }, o.label) as HTMLButtonElement;
  let armedAt = 0;
  let timer: number | undefined;
  let fired = false;

  const setTitle = (t: string | undefined): void => {
    if (t) btn.title = t;
    else btn.removeAttribute('title');
  };

  const disarm = (): void => {
    armedAt = 0;
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timer = undefined;
    }
    btn.classList.remove('btn--danger', 'is-armed');
    btn.textContent = o.label;
    setTitle(o.title);
  };

  const arm = (): void => {
    armedAt = Date.now();
    btn.classList.add('btn--danger', 'is-armed');
    btn.textContent = o.confirmLabel;
    setTitle(o.confirmTitle ?? o.title);
    // One-shot; if a re-render detaches the button while armed this fires once
    // against a detached node and stops. Nothing to leak.
    timer = window.setTimeout(disarm, ARM_TTL_MS);
  };

  const reset = (): void => {
    fired = false;
    btn.disabled = false;
  };

  btn.addEventListener('click', (e) => {
    // Destructive controls sit inside click-through rows (a match row navigates
    // on click); never let arming or committing also trigger the row.
    e.stopPropagation();
    if (fired) return;
    if (!armedAt) {
      arm();
      return;
    }
    if (Date.now() - armedAt < ARM_DWELL_MS) return;
    fired = true;
    disarm();
    btn.disabled = true;
    o.onConfirm(reset);
  });

  btn.addEventListener('keydown', (e) => {
    // A held Enter/Space auto-repeats synthetic clicks milliseconds apart,
    // which would arm and commit faster than the dwell guard can help.
    if (e.repeat && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      return;
    }
    if (e.key === 'Escape' && armedAt) {
      e.stopPropagation();
      disarm();
    }
  });

  btn.addEventListener('blur', () => {
    if (armedAt) disarm();
  });

  return btn;
}

/** One choice in a {@link segmented} control. */
export interface SegOption<T> {
  value: T;
  label: string;
}

/** Multi-way toggle (e.g. time range switches); manages its own active-class state. */
export function segmented<T extends string>(o: {
  options: Array<SegOption<T>>;
  value: T;
  onChange: (value: T) => void;
  fill?: boolean;
}): HTMLElement {
  let currentValue = o.value;
  const buttons = o.options.map((opt) =>
    h('button', { class: `segmented-opt${opt.value === o.value ? ' is-active' : ''}` }, opt.label),
  );
  // Self-manage active state so callers don't have to re-render the control.
  o.options.forEach((opt, i) => {
    buttons[i].addEventListener('click', () => {
      if (opt.value === currentValue) return;
      currentValue = opt.value;
      for (const b of buttons) b.classList.remove('is-active');
      buttons[i].classList.add('is-active');
      o.onChange(opt.value);
    });
  });
  return h('div', { class: `segmented${o.fill ? ' segmented--fill' : ''}` }, ...buttons);
}

/** One entry in a {@link select} dropdown. */
export interface SelectOption {
  value: string;
  label: string;
}

/** A styled native <select>. */
export function select(options: SelectOption[], value: string, onChange: (value: string) => void): HTMLSelectElement {
  const sel = h('select', { class: 'vt-select', on: { change: (e) => onChange((e.target as HTMLSelectElement).value) } }) as HTMLSelectElement;
  for (const o of options) {
    const opt = h('option', { value: o.value }, o.label) as HTMLOptionElement;
    if (o.value === value) opt.selected = true;
    sel.append(opt);
  }
  return sel;
}
