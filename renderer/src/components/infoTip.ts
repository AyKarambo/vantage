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
 */
import { h } from '../dom';

export interface InfoTipOpts {
  /** Accessible name for the button itself, e.g. "What is RTG?". */
  label: string;
}

export function infoTip(text: string, opts: InfoTipOpts): HTMLElement {
  const wrap = h('span', { class: 'info-tip' });
  const btn = h('button', {
    type: 'button',
    class: 'info-tip-btn',
    'aria-label': opts.label,
  }, 'ⓘ') as HTMLButtonElement;
  const panel = h('div', { class: 'info-tip-panel', role: 'tooltip' }, text);

  let open = false;
  // Set only by a click — mouseenter/focusin never set it, so a real click
  // (which a mouse always delivers AFTER the mouseenter that already opened
  // the panel) doesn't read as "already open, so toggle it back off".
  let pinned = false;

  const show = (): void => {
    if (open) return;
    open = true;
    wrap.append(panel);
  };
  const closeAll = (): void => {
    pinned = false;
    if (!open) return;
    open = false;
    panel.remove();
    document.removeEventListener('click', onDocClick);
  };
  // Hover/focus close on their own way out, UNLESS a click has pinned the
  // panel open — that stays open until a click elsewhere or Escape.
  const releaseTransient = (): void => { if (!pinned) closeAll(); };
  const onDocClick = (e: MouseEvent): void => {
    if (!wrap.contains(e.target as Node)) closeAll();
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
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open) closeAll();
  });

  wrap.append(btn);
  return wrap;
}
