/**
 * The large colour-coded Win / Loss / Draw chooser — shared by the quick-log
 * card and the match-detail editor so the two match-entry surfaces render the
 * result control identically (styled by the `.choice--*` classes in
 * components.css). Each button carries `data-value` so a keyboard handler can
 * drive it (the log card binds W/L/D).
 */
import { h } from '../dom';
import type { Result } from '../../../src/shared/contract';

const RESULT_STATE: Record<Result, 'win' | 'loss' | 'draw'> = { Win: 'win', Loss: 'loss', Draw: 'draw' };
const RESULT_KEYS: Record<Result, string> = { Win: 'W', Loss: 'L', Draw: 'D' };

export interface ResultChooserOpts {
  value: Result;
  onChange: (value: Result) => void;
  /** Show the single-key hint (W/L/D) — the caller must bind those keys itself. */
  keys?: boolean;
}

/**
 * Bind W/L/D keys on `scope` to drive a {@link resultChooser} row — skips
 * typing contexts (input/textarea/select) and modifier combos, and clicks the
 * matching `data-value` button so the chooser's own handler stays the single
 * source of state. Shared by the quick-log card and the match-detail editor
 * (`scope` must be focusable so the keydown actually reaches it).
 */
export function bindResultKeys(scope: HTMLElement, row: HTMLElement): void {
  scope.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return;
    const byKey: Record<string, string> = { w: 'Win', l: 'Loss', d: 'Draw' };
    const pick = byKey[e.key.toLowerCase()];
    if (!pick || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    row.querySelectorAll('button').forEach((b) => {
      if (b.dataset.value === pick) b.click();
    });
  });
}

export interface SaveKeysOpts {
  save: () => void;
  /**
   * Ctrl/Cmd+Enter — the log card's "Save & log another". Omitted (the match
   * editor, which has no "next" match to chain into, L5), Ctrl/Cmd+Enter falls
   * back to plain `save` too, so the shortcut still does SOMETHING there
   * rather than silently no-opping.
   */
  saveAndNext?: () => void;
}

/**
 * Enter-to-save, shared by the quick-log card and the match-detail editor
 * (L5 — the editor used to have no Enter-to-save at all). Enter saves from
 * anywhere but a focused button (which keeps its native click) — a typeahead
 * list open elsewhere in the form swallows Enter itself before it gets here,
 * so this never double-fires against one. `scope` must be focusable so the
 * keydown actually reaches it.
 */
export function bindSaveKeys(scope: HTMLElement, opts: SaveKeysOpts): void {
  scope.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    // e.repeat: ignore key-repeat from a held Enter — only a fresh keydown saves.
    if (e.key !== 'Enter' || e.repeat || t instanceof HTMLButtonElement) return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) (opts.saveAndNext ?? opts.save)();
    else opts.save();
  });
}

export function resultChooser(opts: ResultChooserOpts): HTMLElement {
  const options: Result[] = ['Win', 'Loss', 'Draw'];
  const row = h('div', { style: { display: 'flex', gap: '8px' } });
  const buttons = options.map((opt) => {
    const btn = h('button',
      { class: `choice choice--${RESULT_STATE[opt]}${opt === opts.value ? ' is-active' : ''}` },
      opt,
      opts.keys
        ? h('span', { class: 'kbd', style: { marginLeft: '7px', fontSize: '9.5px', opacity: '0.7' } }, RESULT_KEYS[opt])
        : null,
    );
    btn.dataset.value = opt;
    btn.addEventListener('click', () => {
      for (const b of buttons) b.classList.remove('is-active');
      btn.classList.add('is-active');
      opts.onChange(opt);
    });
    return btn;
  });
  row.append(...buttons);
  return row;
}
