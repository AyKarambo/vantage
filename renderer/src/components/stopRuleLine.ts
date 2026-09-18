/**
 * The combined "when to stop" read (S10 phase 1) — shared by Mental, Overview's
 * Mental card and the idle Live screen so the same sentence follows the player
 * everywhere the ingredients (a tilt peak, a winrate fade, the break reminder)
 * would otherwise sit on three different screens with nothing tying them
 * together. Null when {@link stopRule} has nothing sample-gated to say yet.
 */
import { h } from '../dom';
import { stopRule } from '../../../src/core/stopRule';
import { bridge } from '../bridge';
import { inlineLink } from './inlineLink';
import type { ViewContext } from '../views/view';

export function stopRuleLine(ctx: ViewContext): HTMLElement | null {
  const d = ctx.data;
  const rule = stopRule(d.sessionPosition, d.tiltBySession, d.breakReminder);
  if (!rule.sentence) return null;

  // A readable stop point with no armed reminder behind it is the case worth
  // a nudge — with one already on, its configured threshold is the player's
  // own choice, not something this line should second-guess.
  const offerReminder = rule.position !== null && !d.breakReminder.enabled;

  return h('div', { class: 'hint', style: { marginTop: '8px', lineHeight: '1.5' } },
    rule.sentence,
    offerReminder
      ? h('span', null, ' ',
          inlineLink('Set the break reminder to match →', {
            onClick: () => {
              void bridge.setBreakReminder({ ...d.breakReminder, enabled: true }).then(() => ctx.refresh());
            },
          }))
      : null,
  );
}
