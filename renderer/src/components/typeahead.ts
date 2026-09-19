/**
 * A dependency-free typeahead: a text input with a filtered suggestion list.
 * Free text is always allowed — suggestions assist input, they never gate it.
 * Keyboard: ↑/↓ move, Enter/Tab picks, Escape closes the list (not the modal).
 */
import { h, render } from '../dom';

export interface TypeaheadOpts {
  value?: string;
  placeholder?: string;
  /** Browse-mode (empty query) suggestion pool — unchanged meaning from before. */
  suggestions: readonly string[];
  /** Pool filtered once the user has typed a query; falls back to {@link suggestions} when omitted. */
  searchSuggestions?: readonly string[];
  onChange: (value: string) => void;
  inputClass?: string;
  maxItems?: number;
  /** Show the top suggestions on focus, before anything is typed (browse mode). */
  showOnFocus?: boolean;
  /**
   * When true, the committed value can only ever be an exact match from the
   * combined suggestion pool — text that doesn't match reverts to the last
   * committed value on blur. Default false (free text, as before).
   */
  strict?: boolean;
  /** Items in this set render visually muted/deprioritized in the list. */
  mutedItems?: ReadonlySet<string>;
  /**
   * Custom ranking for the typed-query pool (L4) — overrides the default
   * startsWith/contains filter, e.g. `fuzzyRank` so a typo, a missing
   * apostrophe or a missing accent ("kings row", "esperanca") still finds
   * the real entry instead of coming up empty. Also backs `strict` mode's
   * near-miss resolution on blur, below.
   */
  rank?: (query: string, pool: readonly string[]) => string[];
  /**
   * `strict` only (L4): fires on blur when the typed text resolves to
   * neither an exact match nor a single unambiguous `rank` candidate — the
   * field keeps what was typed (no more silently reverting to blank with no
   * explanation) and gets an `is-invalid` class; the caller surfaces its own
   * "not a known X" hint immediately instead of waiting for a save attempt.
   */
  onInvalid?: (typed: string) => void;
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
  let committed = opts.value ?? '';

  const closeList = (): void => {
    list.classList.add('hidden');
    items = [];
    selected = -1;
  };

  const pick = (value: string): void => {
    input.value = value;
    committed = value;
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
        class: `typeahead-item${i === selected ? ' is-selected' : ''}${opts.mutedItems?.has(s) ? ' is-muted' : ''}`,
        // mousedown, not click: fires before the input's blur closes the list.
        on: { mousedown: (e) => { e.preventDefault(); pick(s); } },
      }, s),
    ));
  };

  const refilter = (): void => {
    const q = input.value.trim().toLowerCase();
    let browsing = false;
    if (!q) {
      if (!opts.showOnFocus) {
        closeList();
        return;
      }
      items = opts.suggestions.slice(0, max);
      browsing = true;
    } else {
      const pool = opts.searchSuggestions ?? opts.suggestions;
      const combined = opts.rank
        ? opts.rank(q, pool)
        : [...pool.filter((s) => s.toLowerCase().startsWith(q)), ...pool.filter((s) => !s.toLowerCase().startsWith(q) && s.toLowerCase().includes(q))];
      // Stable sort: muted entries sink to the end, preserving the ranking's
      // own ordering within each bucket.
      const ranked = opts.mutedItems
        ? [...combined.filter((s) => !opts.mutedItems!.has(s)), ...combined.filter((s) => opts.mutedItems!.has(s))]
        : combined;
      items = ranked.slice(0, max);
    }
    // Browse mode (empty query, shown on focus): nothing preselected, so Tab/Enter
    // fall through instead of silently committing the top suggestion.
    selected = items.length ? (browsing ? -1 : 0) : -1;
    paint();
  };

  input.addEventListener('input', () => {
    input.classList.remove('is-invalid'); // typing again is the start of a fix
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
  input.addEventListener('blur', () => {
    setTimeout(() => {
      closeList();
      if (!opts.strict) return;
      const pool = opts.searchSuggestions ?? opts.suggestions;
      const typed = input.value.trim();
      const q = typed.toLowerCase();
      const exact = pool.find((s) => s.toLowerCase() === q);
      if (exact) {
        committed = exact;
        input.value = exact;
        input.classList.remove('is-invalid');
        opts.onChange(exact);
        return;
      }
      // Near-miss resolution (L4): a typo, a missing apostrophe or accent
      // ("kings row", "esperanca") that `rank` still resolves to exactly ONE
      // candidate commits to it — uniqueness is the safety net, not the
      // score alone, so genuinely ambiguous text still falls through below.
      if (opts.rank && q) {
        const candidates = opts.rank(q, pool);
        if (candidates.length === 1) {
          const [only] = candidates;
          committed = only;
          input.value = only;
          input.classList.remove('is-invalid');
          opts.onChange(only);
          return;
        }
      }
      if (!typed) {
        // Nothing typed — quietly revert to the last committed value, same
        // as before; there is nothing to flag as invalid about a blank field.
        input.value = committed;
        input.classList.remove('is-invalid');
        opts.onChange(committed);
        return;
      }
      // No exact or unique-fuzzy match: KEEP what was typed — silently
      // wiping it to blank was the whole bug — flag it, and say why right
      // away instead of only after a save attempt.
      input.classList.add('is-invalid');
      opts.onInvalid?.(input.value);
    }, 100);
  });

  return h('div', { class: 'typeahead' }, input, list);
}
