/**
 * "Your targets" — the tracked list. Rows are deliberately plain: name, grading
 * mode, ONE plain-language status line, hit-rate, and the Active toggle. All
 * analytics (rule, win splits, Focus Trend) and the Edit/Archive/Delete actions
 * live on the target detail page a row click opens. Archived rows keep their
 * compact Restore/Delete form — they have no detail worth opening.
 */
import { h } from '../../dom';
import type { TargetSummary } from '../../../../src/shared/contract';
import { targetStatusSentence } from '../../../../src/core/targets';
import { pct } from '../../format';
import { badge, button, card, chip } from '../../components/primitives';
import { bridge } from '../../bridge';
import type { ViewContext } from '../view';
import { confirmDelete } from './shared';

export function libraryCard(ctx: ViewContext): HTMLElement {
  const live = ctx.data.targets.filter((t) => !t.archivedAt);
  const archived = ctx.data.targets.filter((t) => t.archivedAt);
  return card({ variant: 'raised', title: 'Your targets', sub: 'does it move your winrate?' },
    ...live.map((t) => targetRow(t, ctx)),
    archived.length ? archivedSection(archived, ctx) : null,
  );
}

/** One plain row. The whole row opens the detail page; the Active chip is the
 *  only in-row mutation and is guarded so it never triggers the navigation. */
function targetRow(t: TargetSummary, ctx: ViewContext): HTMLElement {
  const open = (): void => ctx.navigate('targetDetail', { targetId: t.id });
  return h('div', {
    class: 'target-row target-row--link',
    role: 'button',
    tabindex: '0',
    title: 'Open the full breakdown',
    on: {
      click: open,
      keydown: (e) => {
        const key = (e as KeyboardEvent).key;
        if (key === 'Enter' || key === ' ') { e.preventDefault(); open(); }
      },
    },
  },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px' } },
      h('div', { class: 'row-main' },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
          h('span', { class: 'row-name', style: { flex: '0 1 auto', minWidth: '0', fontSize: '13.5px' } }, t.name),
          badge(t.mode === 'measured' ? 'Measured' : 'Self-rated', t.mode === 'measured' ? 'auto' : 'manual'),
        ),
        h('div', { class: 'hint', style: { fontSize: '11.5px', marginTop: '3px', lineHeight: '1.45' } }, targetStatusSentence(t)),
      ),
      activeToggle(t, ctx),
      h('div', { style: { textAlign: 'right', width: '56px', flex: '0 0 auto' } },
        h('div', { class: 'mono', style: { fontSize: '16px', fontWeight: '600' } }, t.attempts ? pct(t.hitRate) : 'New'),
        h('div', { class: 'u-dim', style: { fontSize: '10px' } }, `${t.hits} / ${t.attempts}`),
      ),
      h('span', { class: 'u-dim', style: { fontSize: '12px', flex: '0 0 auto' } }, 'Details ›'),
    ),
  );
}

/** The Active chip (graded on Review), stopPropagation-wrapped so toggling it
 *  never bubbles into the row's open-detail click. */
function activeToggle(t: TargetSummary, ctx: ViewContext): HTMLElement {
  return h('span', {
    style: { flex: '0 0 auto' },
    on: { click: (e) => e.stopPropagation(), keydown: (e) => e.stopPropagation() },
  },
    chip(t.isActive ? '◎ Active on Review' : 'Inactive', t.isActive,
      () => void bridge.setTargetActive(t.id, !t.isActive).then(() => ctx.refresh())),
  );
}

function archivedSection(list: TargetSummary[], ctx: ViewContext): HTMLElement {
  return h('div', { style: { marginTop: '14px', paddingTop: '12px', borderTop: '1px solid var(--border)' } },
    h('div', { class: 'field-label' }, `Archived (${list.length})`),
    ...list.map((t) =>
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 0' } },
        h('div', { class: 'row-main', style: { minWidth: '0' } },
          h('div', { class: 'u-muted', style: { fontSize: '13px' } }, t.name),
          h('div', { class: 'mono u-dim', style: { fontSize: '10.5px', marginTop: '2px' } }, t.rule),
        ),
        button('Restore', {
          variant: 'ghost',
          onClick: () => void bridge.setTargetArchived(t.id, false).then(() => ctx.refresh()),
        }),
        button('Delete', { variant: 'ghost', onClick: () => confirmDelete(t, ctx) }),
      ),
    ),
  );
}
