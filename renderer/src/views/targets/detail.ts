/**
 * Target detail — the parameterized drill-down behind a "Your targets" row.
 * Everything the old expanded row packed into the list lives here at full
 * width: rule, hit-rate, win splits, and the always-open Focus Trend panel
 * (chart + table toggle, guide link, honesty footnote). The list keeps only
 * the plain-language status line. Lifecycle actions live here too — Edit hops
 * back to Targets with the builder pre-filled via `editTargetId`.
 */
import { h } from '../../dom';
import type { TargetSummary } from '../../../../src/shared/contract';
import { pct } from '../../format';
import { PALETTE } from '../../theme';
import { sparkline } from '../../charts/plots';
import { badge, button, card, chip } from '../../components/primitives';
import { phaseChip, targetTrend } from '../../components/targetTrend';
import { toast } from '../../components/toast';
import { bridge } from '../../bridge';
import type { ViewContext } from '../view';
import { winSplit, confirmDelete } from './shared';

export function targetDetail(ctx: ViewContext): HTMLElement {
  const t = ctx.data.targets.find((x) => x.id === ctx.params.targetId);
  if (!t) {
    return h('div', { class: 'view', style: { maxWidth: '760px' } },
      backRow(ctx),
      card({}, h('div', { class: 'empty' }, 'This target is no longer in your library.')),
    );
  }
  return h('div', { class: 'view', style: { maxWidth: '760px' } },
    backRow(ctx),
    headerCard(t, ctx),
    t.learning
      ? targetTrend(t.learning)
      : h('div', { class: 'hint', style: { marginTop: '12px' } },
          'No focus trend yet — it appears once this target is live and tracking your games.'),
  );
}

function backRow(ctx: ViewContext): HTMLElement {
  return h('div', null, button('← Targets', { variant: 'ghost', onClick: () => ctx.navigate('targets') }));
}

/** Name, rule, grading mode, phase, hit-rate, grade history, and win splits. */
function headerCard(t: TargetSummary, ctx: ViewContext): HTMLElement {
  const accent = t.mode === 'measured' ? PALETTE.win : PALETTE.accent;
  return card({ variant: 'raised', title: t.name, sub: t.rule },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', marginTop: '4px' } },
      badge(t.mode === 'measured' ? 'Measured' : 'Self-rated', t.mode === 'measured' ? 'auto' : 'manual'),
      t.learning ? phaseChip(t.learning) : null,
      h('span', { style: { flex: '1' } }),
      sparkline(t.spark, { width: 150, height: 34, color: accent, fill: true }),
      h('div', { style: { textAlign: 'right', width: '56px', flex: '0 0 auto' } },
        h('div', { class: 'mono', style: { fontSize: '16px', fontWeight: '600' } }, t.attempts ? pct(t.hitRate) : 'New'),
        h('div', { class: 'u-dim', style: { fontSize: '10px' } }, `${t.hits} / ${t.attempts}`),
      ),
    ),
    winSplit('win when hit', t.winWhenHit, PALETTE.win, PALETTE.winText),
    winSplit('when missed', t.winWhenMissed, 'rgba(255,255,255,0.16)', PALETTE.muted),
    actionsRow(t, ctx),
  );
}

/** Lifecycle controls. Archive and Delete land back on the list — an archived
 *  target drops its learning model and a deleted one has no page to stay on. */
function actionsRow(t: TargetSummary, ctx: ViewContext): HTMLElement {
  return h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px' } },
    chip(t.isActive ? '◎ Active on Review' : 'Inactive', t.isActive,
      () => void bridge.setTargetActive(t.id, !t.isActive).then(() => ctx.refresh())),
    h('span', { style: { flex: '1' } }),
    button('Edit', { variant: 'ghost', onClick: () => ctx.navigate('targets', { editTargetId: t.id }) }),
    // Archive is reversible → no confirmation, immediate with Undo (delete keeps its modal).
    button('Archive', {
      variant: 'ghost',
      onClick: () => void bridge.setTargetArchived(t.id, true).then(() => {
        ctx.navigate('targets');
        ctx.refresh();
        toast(`Archived "${t.name}"`, {
          action: {
            label: 'Undo',
            run: () => void bridge.setTargetArchived(t.id, false).then(() => ctx.refresh()),
          },
        });
      }),
    }),
    button('Delete', { variant: 'ghost', onClick: () => confirmDelete(t, ctx, () => ctx.navigate('targets')) }),
  );
}
