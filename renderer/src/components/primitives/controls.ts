/**
 * Interactive input controls — buttons, segmented switches, and the native
 * select wrapper. Each is a pure factory over its options, self-managing any
 * transient UI state (e.g. the active segment) so callers don't re-render.
 */
import { h } from '../../dom';

type Child = Node | string | number | null | undefined | false;

/** Options for {@link button}; `variant` picks the visual weight, `default` is unstyled. */
export interface BtnOpts {
  variant?: 'primary' | 'soft' | 'ghost' | 'default';
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
