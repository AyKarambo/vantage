/**
 * Toast notifications — the feedback layer for saves and the undo affordance
 * for reversible actions. One host element (mounted by the shell) stacks
 * toasts bottom-right; each auto-dismisses after its TTL, pausing while
 * hovered. Screen readers hear them via aria-live.
 */
import { h } from '../dom';

export interface ToastOpts {
  /** Optional action button (e.g. Undo) — runs once, then dismisses. */
  action?: { label: string; run: () => void };
  /** Auto-dismiss after this many ms (default 6000). */
  ttl?: number;
}

let host: HTMLElement | null = null;

/** Mount the toast host once (no-op afterwards). The shell calls this. */
export function mountToastHost(): void {
  if (host) return;
  host = h('div', { class: 'toast-host', 'aria-live': 'polite' });
  document.body.append(host);
}

/** Show a toast. Safe to call before mount (mounts lazily). */
export function toast(message: string, opts: ToastOpts = {}): void {
  mountToastHost();
  const ttl = opts.ttl ?? 6000;

  const el = h('div', { class: 'toast' },
    h('span', { class: 'toast-msg' }, message),
    opts.action
      ? h('button', {
          class: 'toast-action',
          on: {
            click: () => {
              opts.action!.run();
              dismiss();
            },
          },
        }, opts.action.label)
      : null,
    h('button', { class: 'toast-close', 'aria-label': 'Dismiss', on: { click: () => dismiss() } }, '✕'),
  );

  let timer = window.setTimeout(dismiss, ttl);
  el.addEventListener('mouseenter', () => clearTimeout(timer));
  el.addEventListener('mouseleave', () => (timer = window.setTimeout(dismiss, ttl)));

  function dismiss(): void {
    clearTimeout(timer);
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 160);
  }

  host!.append(el);
}
