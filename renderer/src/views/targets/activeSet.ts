/**
 * Active-set rotation panel: the targets you're currently grading/tracking as
 * your focus, with quick add/remove and a one-click "start a fresh focus" reset.
 * A target that has been active past the staleness thresholds gets a rotate
 * nudge, so the focus set doesn't go stale. Sits above the library on the
 * Targets screen. Sample/demo libraries have no lifecycle, so it renders nothing.
 */
import { h } from '../../dom';
import type { TargetSummary } from '../../../../src/shared/contract';
import { isStale } from '../../../../src/core/staleness';
import { button, card, select } from '../../components/primitives';
import { bridge } from '../../bridge';
import type { ViewContext } from '../view';

export function activeSetCard(ctx: ViewContext): HTMLElement | null {
  if (ctx.data.isSample) return null;
  const live = ctx.data.targets.filter((t) => !t.archivedAt);
  if (!live.length) return null;
  const active = live.filter((t) => t.isActive);
  const inactive = live.filter((t) => !t.isActive);
  const now = Date.now();
  const refreshAfter = (p: Promise<void>): void => { void p.then(() => ctx.refresh()); };

  const activeChips = active.length
    ? active.map((t) => activeChip(t, now, ctx, () => refreshAfter(bridge.setTargetActive(t.id, false))))
    : [h('span', { class: 'u-dim', style: { fontSize: '12px' } }, 'No active targets — add one below to start grading.')];

  const controls = h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '12px', flexWrap: 'wrap' } },
    inactive.length
      ? select(
          [{ value: '', label: '＋ add a target…' }, ...inactive.map((t) => ({ value: t.id, label: t.name }))],
          '',
          (id) => { if (id) refreshAfter(bridge.setTargetActive(id, true)); },
        )
      : null,
    h('span', { style: { flex: '1' } }),
    active.length
      ? button('Start a fresh focus', { variant: 'ghost', onClick: () => refreshAfter(bridge.deactivateAllTargets()) })
      : null,
  );

  return card(
    { variant: 'raised', title: 'Active focus', sub: "what you're grading now — rotate it when it goes stale" },
    h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '7px' } }, ...activeChips),
    controls,
  );
}

/** One active target as a removable chip, with a staleness nudge when it's overdue for rotation. */
function activeChip(t: TargetSummary, now: number, ctx: ViewContext, onRemove: () => void): HTMLElement {
  const stale = isStale(t.activatedAt, t.matchesSinceActive, now, ctx.data.staleness);
  return h('button', {
    class: stale ? 'chip is-on chip--stale' : 'chip is-on',
    title: stale
      ? 'Getting stale — consider rotating it out or archiving it. Click to remove from your active focus.'
      : 'Click to remove from your active focus',
    on: { click: onRemove },
  },
    `${t.name} ✕`,
    stale ? h('span', { style: { marginLeft: '6px', opacity: '0.85' } }, '· stale') : null,
  );
}
