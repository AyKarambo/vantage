/**
 * The sticky header shared by the quick-log card and the match-detail editor
 * (L5) — before this, the editor's own header was a plain title-plus-subtitle
 * div that had drifted from the log card's badge/close-button chrome. One
 * factory now backs both, so the two match-entry surfaces can't drift again.
 */
import { h } from '../dom';

type Child = Node | string | number | null | undefined | false;

export interface DialogHeaderOpts {
  title: string;
  /** Extra controls between the title and the badge (e.g. the log card's account select, or the editor's read-only map/role label). */
  extra?: Node[];
  /** The provenance badge (and any pill beside it, e.g. 'edited') — built by the caller so this stays state-agnostic. */
  badge: Child;
  onClose: () => void;
}

export function dialogHeader(opts: DialogHeaderOpts): HTMLElement {
  return h('div', {
    style: {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px',
      borderBottom: '1px solid var(--border)', position: 'sticky', top: '0', background: 'var(--card)', zIndex: '1',
    },
  },
    h('div', { style: { fontFamily: 'var(--font-head)', fontSize: '16px', fontWeight: '600' } }, opts.title),
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
      ...(opts.extra ?? []),
      opts.badge,
      h('button', { class: 'overlay-close', on: { click: opts.onClose } }, '✕'),
    ),
  );
}
