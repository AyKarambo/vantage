/**
 * "What's new" highlight — shown once after an update (never on a fresh
 * install; the decision of *when* lives entirely in `src/core/whatsNew.ts`,
 * this module only renders what it's handed). Purely informational, unlike
 * `firstRunPrompt`: it may be dismissed freely, and every dismissal path (✕,
 * Escape, or the confirm button) must be treated the same, or the modal would
 * reappear on the next launch and "exactly once" would break. Mirrors
 * `onboarding.ts`'s hand-rolled overlay/modal-card structure and its posture —
 * no backdrop-click dismissal.
 */
import { h, render } from '../dom';
import { button } from '../components/primitives';
import type { ChangelogEntry } from '../../../src/core/whatsNew';

/**
 * Render `entries` (already filtered to "unseen" by the caller) in a centered
 * modal; calls `onDismiss` exactly once, however the modal was closed.
 */
export function openWhatsNewPrompt(entries: readonly ChangelogEntry[], onDismiss: () => void): void {
  const panel = h('div', { class: 'modal-card', style: { width: '480px', maxWidth: '92vw' } });
  const overlay = h('div', { class: 'overlay overlay--center' }, panel);
  let settled = false;

  const finish = (): void => {
    if (settled) return;
    settled = true;
    window.removeEventListener('keydown', onKey);
    overlay.remove();
    onDismiss();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') finish();
  };

  // No backdrop-click handler is attached (same posture as onboarding.ts) —
  // clicking outside the panel is a no-op, not a dismissal.
  panel.addEventListener('click', (e) => e.stopPropagation());
  window.addEventListener('keydown', onKey);

  render(panel,
    h('div', {
      style: {
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '16px 20px', borderBottom: '1px solid var(--border)',
      },
    },
      h('div', { style: { fontFamily: 'var(--font-head)', fontSize: '16px', fontWeight: '600' } }, 'What’s new'),
      h('button', { class: 'overlay-close', title: 'Close', on: { click: finish } }, '✕'),
    ),
    h('div', { class: 'stack', style: { gap: '16px', padding: '20px', maxHeight: '55vh', overflowY: 'auto' } },
      ...entries.map(entryBlock),
    ),
    h('div', {
      style: {
        display: 'flex', justifyContent: 'flex-end',
        padding: '14px 20px', borderTop: '1px solid var(--border)',
      },
    },
      button('Got it', { variant: 'primary', onClick: finish }),
    ),
  );

  document.body.appendChild(overlay);
}

/** One version's release notes: version (+ date if stamped) and a plain bullet
 *  list. `notes` are already flat, markdown-stripped text — never `innerHTML`. */
function entryBlock(entry: ChangelogEntry): HTMLElement {
  return h('div', null,
    h('div', { style: { display: 'flex', alignItems: 'baseline', gap: '8px' } },
      h('span', { style: { fontFamily: 'var(--font-head)', fontSize: '13.5px', fontWeight: '600' } }, `v${entry.version}`),
      entry.date ? h('span', { class: 'u-dim', style: { fontSize: '11.5px' } }, entry.date) : null,
    ),
    h('ul', { style: { margin: '8px 0 0', paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '6px' } },
      ...entry.notes.map((note) => h('li', { style: { fontSize: '12.5px', lineHeight: '1.5', color: 'var(--text-2)' } }, note)),
    ),
  );
}
