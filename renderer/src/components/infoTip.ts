/**
 * A keyboard-reachable "what does this mean" affordance — a small ⓘ button
 * that shows an explanation on hover, focus, OR click (a native `title`
 * attribute needs a ~1s hover, can't be styled to wrap, is invisible to
 * keyboard users, and gets clipped by the frameless window's edge — this
 * replaces the bare `title` the renderer otherwise leans on for column-header
 * and card-subtitle explanations). Deliberately lighter than
 * {@link ../components/popover}'s `openPopover`: no backdrop, closes the
 * instant the pointer/focus leaves, so it behaves like a tooltip that can
 * wrap and be triggered without a mouse — not a second modal layer (K8).
 *
 * The visible panel is portalled to `document.body` and positioned `fixed`
 * against the trigger (issue #339): it can't be clipped by a card's or a
 * modal's `overflow`, and it is edge-aware — it opens above the ⓘ, flips
 * below when there's no room, and shifts sideways to stay inside the
 * frameless window (the caret keeps pointing at the ⓘ). The text also lives
 * in a visually-hidden node inside the trigger's wrapper that the button's
 * `aria-describedby` points at, so a screen reader announces the explanation
 * on focus whether or not the panel happens to be open.
 */
import { h } from '../dom';

export interface InfoTipOpts {
  /** Accessible name for the button itself, e.g. "What is RTG?". */
  label: string;
  /** Optional bold first line above the body — a short heading for longer explanations. */
  title?: string;
}

/** Gap between the ⓘ and the panel, and the minimum clearance kept from every window edge. */
const GAP = 8;
const EDGE = 8;

let tipSeq = 0;

export function infoTip(text: string, opts: InfoTipOpts): HTMLElement {
  const id = `info-tip-${++tipSeq}`;
  const wrap = h('span', { class: 'info-tip' });
  const btn = h('button', {
    type: 'button',
    class: 'info-tip-btn',
    'aria-label': opts.label,
    'aria-describedby': id,
  }, 'ⓘ') as HTMLButtonElement;
  // The description screen readers get (hidden visually, NOT `hidden`, so it
  // stays in the accessibility tree for aria-describedby).
  const srText = h('span', { id, class: 'sr-only' }, opts.title ? `${opts.title}. ${text}` : text);
  const caret = h('span', { class: 'info-tip-caret' });
  // The floating copy is decorative for assistive tech — the description above
  // already carries the text — so it's hidden from the tree to avoid reading it twice.
  const panel = h('div', { class: 'info-tip-panel', role: 'tooltip', 'aria-hidden': 'true' },
    opts.title ? h('div', { class: 'info-tip-title' }, opts.title) : null,
    h('div', { class: 'info-tip-body' }, text),
    caret,
  );

  let open = false;
  // Set only by a click — mouseenter/focusin never set it, so a real click
  // (which a mouse always delivers AFTER the mouseenter that already opened
  // the panel) doesn't read as "already open, so toggle it back off".
  let pinned = false;

  /** Place the panel above the ⓘ (or below when it won't fit), clamped inside the window. */
  const place = (): void => {
    if (!btn.isConnected) { closeAll(); return; }
    const b = btn.getBoundingClientRect();
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = document.documentElement.clientHeight || window.innerHeight;
    const pw = panel.offsetWidth;
    const ph = panel.offsetHeight;
    const above = b.top - GAP - ph >= EDGE || b.bottom + GAP + ph > vh - EDGE && b.top > vh - b.bottom;
    const top = above ? b.top - GAP - ph : b.bottom + GAP;
    const centre = b.left + b.width / 2;
    const left = Math.min(Math.max(centre - pw / 2, EDGE), Math.max(EDGE, vw - EDGE - pw));
    panel.style.top = `${Math.round(top)}px`;
    panel.style.left = `${Math.round(left)}px`;
    panel.dataset.side = above ? 'top' : 'bottom';
    // Keep the caret on the ⓘ even when the panel had to shift sideways.
    caret.style.left = `${Math.round(Math.min(Math.max(centre - left, 12), pw - 12))}px`;
  };

  const show = (): void => {
    if (open) return;
    open = true;
    document.body.append(panel);
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    document.addEventListener('keydown', onDocKey, true);
  };
  const closeAll = (): void => {
    pinned = false;
    if (!open) return;
    open = false;
    panel.remove();
    window.removeEventListener('scroll', place, true);
    window.removeEventListener('resize', place);
    document.removeEventListener('keydown', onDocKey, true);
    document.removeEventListener('click', onDocClick);
  };
  // Hover/focus close on their own way out, UNLESS a click has pinned the
  // panel open — that stays open until a click elsewhere or Escape.
  const releaseTransient = (): void => { if (!pinned) closeAll(); };
  const onDocClick = (e: MouseEvent): void => {
    if (!wrap.contains(e.target as Node)) closeAll();
  };
  // Escape closes from anywhere (a hover-opened tip has no focus to listen on),
  // and is swallowed so it doesn't also dismiss a modal the tip sits inside.
  const onDocKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || !open) return;
    e.stopPropagation();
    e.preventDefault();
    closeAll();
  };

  btn.addEventListener('mouseenter', show);
  btn.addEventListener('mouseleave', releaseTransient);
  btn.addEventListener('focusin', show);
  btn.addEventListener('focusout', releaseTransient);
  // Click PINS the panel open — the touch/no-hover path, and the one that
  // survives the pointer moving away — closed by a click anywhere else or
  // Escape, not by mouseleave.
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (pinned) { closeAll(); return; }
    pinned = true;
    show();
    document.addEventListener('click', onDocClick);
  });

  wrap.append(btn, srText);
  return wrap;
}
