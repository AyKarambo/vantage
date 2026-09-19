/**
 * The pre-session mood check-in (S10 phase 2): "Calm / Edgy / Tilted", logged
 * with one click before queuing — the missing half of the stop-rule read
 * ({@link ./stopRuleLine}), which could say when to stop but never asked how
 * a sitting started. Feeds `tiltByCheckIn` (`src/core/mentalAnalytics.ts`),
 * which splits a sitting's first-game tilt rate by whichever mood preceded
 * it, so Mental can eventually say whether queuing tilted actually costs you.
 * Shown on the idle Live screen and the Overview head — the two places a
 * player looks right before queuing.
 */
import { h } from '../dom';
import { button } from './primitives';
import { bridge } from '../bridge';
import { CHECK_IN_FRESH_MINUTES, CHECK_IN_LABELS, CHECK_IN_MOODS, type CheckInMood } from '../../../src/shared/contract';
import type { ViewContext } from '../views/view';

export function checkInPrompt(ctx: ViewContext): HTMLElement | null {
  // A mood check-in about a sample season means nothing, and would otherwise
  // sit in the SAME unscoped store real check-ins do — logging one here would
  // leak into the tiltByCheckIn read once real history exists.
  if (ctx.data.isSample) return null;
  const checkIns = ctx.data.checkIns;
  const last = checkIns[checkIns.length - 1]; // oldest-first — the last entry is the most recent
  const fresh = last && Date.now() - last.at <= CHECK_IN_FRESH_MINUTES * 60_000;

  if (fresh) {
    return h('div', { class: 'hint', style: { lineHeight: '1.5' } },
      `Logged: ${CHECK_IN_LABELS[last.mood]} — good luck out there.`,
    );
  }

  const record = (mood: CheckInMood): void => {
    void bridge.recordCheckIn(mood).then(() => ctx.refresh());
  };

  return h('div', null,
    h('div', { class: 'hint', style: { marginBottom: '6px' } }, 'How are you feeling right now?'),
    h('div', { style: { display: 'flex', gap: '6px' } },
      ...CHECK_IN_MOODS.map((mood) =>
        button(CHECK_IN_LABELS[mood], { variant: 'soft', onClick: () => record(mood) }),
      ),
    ),
  );
}
