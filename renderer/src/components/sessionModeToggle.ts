/**
 * The Stats ↔ Training session-mode switch (issue #342) — shared by the
 * sidebar's Current session card, the Matches header and the command palette.
 * Training is an explicit choice, never inferred from having targets; matches
 * recorded while it is on are stamped `training` in the main process, so this
 * control only flips the persisted mode and refreshes.
 */
import { h } from '../dom';
import type { SessionMode } from '../../../src/shared/contract';
import { canTrain } from '../../../src/core/practice/sessionMode';
import { bridge } from '../bridge';
import { segmented } from './primitives';
import { inlineLink } from './inlineLink';
import { toast } from './toast';
import type { ViewContext } from '../views/view';

/** Switch the session mode, confirm it in a toast, and refetch so every surface follows. */
export function setSessionMode(ctx: ViewContext, mode: SessionMode): void {
  void bridge.setSessionMode(mode).then(() => {
    toast(mode === 'training'
      ? 'Training mode on — new matches are judged by your targets, not the result'
      : 'Stats mode on — Matches leads with win/loss again', { ttl: 4000 });
    ctx.refresh();
  });
}

/** Whether Training can be switched on right now (needs an active self-rated target). */
export function trainingAvailable(ctx: ViewContext): boolean {
  return canTrain(ctx.data.targets);
}

/**
 * The toggle itself. With no active self-rated target to drill (and Training
 * not already on), it offers "Pick a target →" instead of a Training option
 * that would have nothing to grade.
 */
export function sessionModeToggle(ctx: ViewContext, opts: { compact?: boolean } = {}): HTMLElement {
  const mode = ctx.data.sessionMode.mode;
  const pickTarget = inlineLink('Pick a target →', {
    title: 'Training drills an active self-rated target — pick or create one on Targets',
    onClick: (e) => { e.stopPropagation(); ctx.navigate('targets'); },
  });
  if (mode === 'stats' && !trainingAvailable(ctx)) {
    return h('div', {
      class: `session-mode${opts.compact ? ' session-mode--compact' : ''}`,
      title: 'Training mode needs an active self-rated target',
    }, h('span', { class: 'u-muted session-mode-label' }, 'Training:'), pickTarget);
  }
  const control = segmented<SessionMode>({
    options: [{ value: 'stats', label: 'Stats' }, { value: 'training', label: 'Training' }],
    value: mode,
    onChange: (next) => setSessionMode(ctx, next),
  });
  control.title = mode === 'training'
    ? 'Training: Matches leads with how well you executed your targets; win/loss stays tracked but hidden'
    : 'Stats: Matches leads with win/loss. Switch to Training for a sitting about drilling a target';
  control.setAttribute('aria-label', 'Session mode');
  return h('div', { class: `session-mode${opts.compact ? ' session-mode--compact' : ''}` }, control);
}
