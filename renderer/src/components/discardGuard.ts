/**
 * "Only close on purpose" for the match-entry dialogs (#340). Log Match and
 * Edit Match open with backdrop and Escape dismissal switched off at the
 * overlay level; this guard owns closing instead:
 *
 * - Escape (when no dropdown inside the form consumed it), the header ✕ and
 *   Cancel all go through {@link DiscardGuard.request};
 * - an untouched form closes straight away;
 * - a touched one swaps the footer for an inline "Discard this match?"
 *   confirm (never a second modal — overlays don't stack). Enter or Escape
 *   there keeps editing; only the Discard button throws the input away.
 */
import { h } from '../dom';
import { button } from './primitives';

export interface DiscardGuard {
  /** Close if untouched, else ask first. */
  request: () => void;
  /** Whether the user has changed anything since the dialog opened. */
  dirty: () => boolean;
  /** The inline confirm row — append it to the dialog's sticky footer. */
  confirmEl: HTMLElement;
}

export function discardGuard(opts: {
  /** The dialog root: input/change events and button clicks inside `body` mark it dirty. */
  root: HTMLElement;
  /** The editable part of the dialog (excludes header and footer). */
  body: HTMLElement;
  /** The footer's normal content, hidden while the confirm shows. */
  footerContent: HTMLElement;
  close: () => void;
  /** What is being discarded, e.g. "this match" / "your changes". */
  noun: string;
}): DiscardGuard {
  let dirty = false;
  const markDirty = (): void => { dirty = true; };
  opts.body.addEventListener('input', markDirty);
  opts.body.addEventListener('change', markDirty);
  opts.body.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('button')) markDirty();
  });
  // W/L/D and H/P/M click buttons programmatically — those bubble as clicks too.

  const keep = button('Keep editing', { variant: 'primary', onClick: () => hide() });
  const discard = button('Discard', { variant: 'danger', onClick: () => opts.close() });
  const confirmEl = h('div', {
    class: 'discard-confirm hidden', role: 'alertdialog', 'aria-label': `Discard ${opts.noun}?`,
    style: { display: 'flex', gap: '10px', alignItems: 'center', flex: '1' },
  },
    h('span', { style: { flex: '1', fontWeight: '600' } }, `Discard ${opts.noun}?`),
    keep, discard,
  );

  let asking = false;
  const show = (): void => {
    asking = true;
    opts.footerContent.classList.add('hidden');
    confirmEl.classList.remove('hidden');
    keep.focus();
  };
  const hide = (): void => {
    asking = false;
    confirmEl.classList.add('hidden');
    opts.footerContent.classList.remove('hidden');
    opts.root.focus();
  };

  const request = (): void => {
    if (asking) { hide(); return; }
    if (dirty) show();
    else opts.close();
  };

  opts.root.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault();
    e.stopPropagation();
    request();
  });

  return { request, dirty: () => dirty, confirmEl };
}
