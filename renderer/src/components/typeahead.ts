/**
 * A dependency-free typeahead: a text input with a filtered suggestion list.
 * Free text is always allowed — suggestions assist input, they never gate it.
 * Keyboard: ↑/↓ move, Enter/Tab picks, Escape closes the list (not the modal).
 */
import { h, render } from '../dom';

export interface TypeaheadOpts {
  value?: string;
  placeholder?: string;
  suggestions: readonly string[];
  onChange: (value: string) => void;
  inputClass?: string;
  maxItems?: number;
  /** Show the top suggestions on focus, before anything is typed (browse mode). */
  showOnFocus?: boolean;
}

export function typeahead(opts: TypeaheadOpts): HTMLElement {
  const max = opts.maxItems ?? 8;
  const input = h('input', {
    class: opts.inputClass ?? 'target-name-input',
    value: opts.value ?? '',
    placeholder: opts.placeholder,
    autocomplete: 'off',
  }) as HTMLInputElement;
  const list = h('div', { class: 'typeahead-list hidden' });
  let items: string[] = [];
  let selected = -1;

  const closeList = (): void => {
    list.classList.add('hidden');
    items = [];
    selected = -1;
  };

  const pick = (value: string): void => {
    input.value = value;
    opts.onChange(value);
    closeList();
  };

  const paint = (): void => {
    if (!items.length) {
      closeList();
      return;
    }
    list.classList.remove('hidden');
    render(list, items.map((s, i) =>
      h('div', {
        class: `typeahead-item${i === selected ? ' is-selected' : ''}`,
        // mousedown, not click: fires before the input's blur closes the list.
        on: { mousedown: (e) => { e.preventDefault(); pick(s); } },
      }, s),
    ));
  };

  const refilter = (): void => {
    const q = input.value.trim().toLowerCase();
    if (!q) {
      if (!opts.showOnFocus) {
        closeList();
        return;
      }
      items = opts.suggestions.slice(0, max);
    } else {
      const starts = opts.suggestions.filter((s) => s.toLowerCase().startsWith(q));
      const contains = opts.suggestions.filter((s) => !s.toLowerCase().startsWith(q) && s.toLowerCase().includes(q));
      items = [...starts, ...contains].slice(0, max);
    }
    selected = items.length ? 0 : -1;
    paint();
  };

  input.addEventListener('input', () => {
    opts.onChange(input.value);
    refilter();
  });
  if (opts.showOnFocus) input.addEventListener('focus', refilter);

  input.addEventListener('keydown', (e) => {
    if (list.classList.contains('hidden')) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      selected = (selected + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      paint();
    } else if ((e.key === 'Enter' || e.key === 'Tab') && selected >= 0) {
      e.preventDefault();
      e.stopPropagation(); // picking must not reach a surrounding Enter-to-save handler
      pick(items[selected]);
    } else if (e.key === 'Escape') {
      e.stopPropagation(); // close the list, not the surrounding modal
      closeList();
    }
  });
  input.addEventListener('blur', () => setTimeout(closeList, 100));

  return h('div', { class: 'typeahead' }, input, list);
}
