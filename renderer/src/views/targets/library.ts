/**
 * Improvement Target library — the tracked list with lifecycle controls. Rows
 * carry Active toggle (graded on Review), Archive/Restore, and permanent Delete
 * behind a confirmation.
 */
import { h } from '../../dom';
import type { TargetSummary } from '../../../../src/shared/contract';
import { pct } from '../../format';
import { PALETTE } from '../../theme';
import { sparkline } from '../../charts/plots';
import { badge, button, card, chip } from '../../components/primitives';
import { openModal } from '../../components/overlay';
import { bridge } from '../../bridge';
import type { ViewContext } from '../view';

export function libraryCard(ctx: ViewContext, onEdit: (t: TargetSummary) => void): HTMLElement {
  const live = ctx.data.targets.filter((t) => !t.archivedAt);
  const archived = ctx.data.targets.filter((t) => t.archivedAt);
  return card({ variant: 'raised', title: 'Your targets', sub: 'does it move your winrate?' },
    ...live.map((t) => targetRow(t, ctx, onEdit)),
    archived.length ? archivedSection(archived, ctx) : null,
  );
}

function targetRow(t: TargetSummary, ctx: ViewContext, onEdit: (t: TargetSummary) => void): HTMLElement {
  const accent = t.mode === 'measured' ? PALETTE.win : PALETTE.accent;
  return h('div', { class: 'target-row' },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px' } },
      h('div', { class: 'row-main' },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
          h('span', { class: 'row-name', style: { flex: '0 1 auto', minWidth: '0', fontSize: '13.5px' } }, t.name),
          badge(t.mode === 'measured' ? 'Measured' : 'Self-rated', t.mode === 'measured' ? 'auto' : 'manual'),
        ),
        h('div', { class: 'mono u-dim', style: { fontSize: '10.5px', marginTop: '3px' } }, t.rule),
      ),
      sparkline(t.spark, { width: 150, height: 34, color: accent, fill: true }),
      h('div', { style: { textAlign: 'right', width: '56px', flex: '0 0 auto' } },
        h('div', { class: 'mono', style: { fontSize: '16px', fontWeight: '600' } }, t.attempts ? pct(t.hitRate) : 'New'),
        h('div', { class: 'u-dim', style: { fontSize: '10px' } }, `${t.hits} / ${t.attempts}`),
      ),
    ),
    winSplit('win when hit', t.winWhenHit, PALETTE.win, PALETTE.winText),
    winSplit('when missed', t.winWhenMissed, 'rgba(255,255,255,0.16)', PALETTE.muted),
    rowActions(t, ctx, onEdit),
  );
}

/** Lifecycle controls: Active = graded on Review; Archive keeps history restorable. */
function rowActions(t: TargetSummary, ctx: ViewContext, onEdit: (t: TargetSummary) => void): HTMLElement {
  const refreshAfter = (p: Promise<void>): void => { void p.then(() => ctx.refresh()); };
  return h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px' } },
    chip(t.isActive ? '◎ Active on Review' : 'Inactive', t.isActive,
      () => refreshAfter(bridge.setTargetActive(t.id, !t.isActive))),
    h('span', { style: { flex: '1' } }),
    button('Edit', { variant: 'ghost', onClick: () => onEdit(t) }),
    button('Archive', { variant: 'ghost', onClick: () => refreshAfter(bridge.setTargetArchived(t.id, true)) }),
    button('Delete', { variant: 'ghost', onClick: () => confirmDelete(t, ctx) }),
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

function confirmDelete(t: TargetSummary, ctx: ViewContext): void {
  openModal((close) =>
    h('div', { style: { padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' } },
      h('div', { style: { fontFamily: 'var(--font-head)', fontSize: '16px', fontWeight: '600' } }, `Delete "${t.name}"?`),
      h('div', { class: 'hint', style: { lineHeight: '1.5' } },
        'This permanently removes the target from your library and its stats stop counting. Grades already saved on match reviews stay stored but inert. Archive instead if you might want it back.'),
      h('div', { style: { display: 'flex', gap: '10px' } },
        button('Delete permanently', {
          variant: 'primary',
          onClick: () => void bridge.deleteTarget(t.id).then(() => { close(); ctx.refresh(); }),
        }),
        button('Keep it', { variant: 'ghost', onClick: close }),
      ),
    ),
  );
}

function winSplit(label: string, frac: number, barColor: string, textColor: string): HTMLElement {
  const fill = h('div', { class: 'track-fill', style: { width: `${Math.round(frac * 100)}%`, background: barColor } });
  return h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '6px' } },
    h('span', { style: { fontSize: '10px', color: 'var(--muted-2)', width: '82px', flex: '0 0 auto' } }, label),
    h('div', { class: 'track track--slim' }, fill),
    h('span', { class: 'mono', style: { fontSize: '10.5px', color: textColor, width: '30px', textAlign: 'right', flex: '0 0 auto' } }, pct(frac)),
  );
}

