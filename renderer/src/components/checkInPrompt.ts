/**
 * The pre-session mood check-in (S10 phase 2): "Calm / Edgy / Tilted", logged
 * with one click before queuing — the missing half of the stop-rule read
 * ({@link ./stopRuleLine}), which could say when to stop but never asked how
 * a sitting started. Feeds `tiltByCheckIn` (`src/core/mentalAnalytics.ts`),
 * which splits a sitting's first-game tilt rate by whichever mood preceded
 * it, so Mental can eventually say whether queuing tilted actually costs you.
 * Shown on the idle Live screen and the Overview head — the two places a
 * player looks right before queuing.
 *
 * Issue #321 adds optional questions — sleep, energy, whether you ate — each
 * switched on in Settings › Coaching, plus "today's focus" while practice
 * mode is on and targets are active. The mood click is always the one click
 * that logs (AC16): any optional answers are picked BEFORE it and ride along,
 * and skipping them all logs mood alone, exactly as before.
 */
import { h, render } from '../dom';
import { button } from './primitives';
import { bridge } from '../bridge';
import {
  CHECK_IN_ENERGY, CHECK_IN_ENERGY_LABELS, CHECK_IN_FRESH_MINUTES, CHECK_IN_LABELS, CHECK_IN_MOODS, CHECK_IN_SLEEP,
  CHECK_IN_SLEEP_LABELS, type CheckInInput, type CheckInMood,
} from '../../../src/shared/contract';
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

  const q = ctx.data.coachingSettings.checkInQuestions;
  const focusTargets = ctx.data.practice.on
    ? ctx.data.targets.filter((t) => t.isActive && !t.archivedAt && t.mode !== 'measured')
    : [];
  const extended = q.sleep || q.energy || q.ate || focusTargets.length > 0;

  if (!extended) {
    const record = (mood: CheckInMood): void => {
      void bridge.recordCheckIn({ mood }).then(() => ctx.refresh());
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

  const answer: Partial<CheckInInput> = {};
  const host = h('div', { class: 'stack', style: { gap: '9px' } });

  /** One labelled single-choice row; clicking the chosen option again clears it (every extra is optional). */
  const choiceRow = <T extends string>(label: string, options: readonly T[], labels: Record<T, string>, get: () => T | undefined, set: (v: T | undefined) => void): HTMLElement =>
    h('div', { class: 'check-in-row' },
      h('span', { class: 'hint' }, label),
      h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } },
        ...options.map((v) => {
          const b = h('button', { class: `chip${get() === v ? ' is-on' : ''}` }, labels[v]);
          b.addEventListener('click', () => { set(get() === v ? undefined : v); paint(); });
          return b;
        }),
      ),
    );

  const record = (mood: CheckInMood): void => {
    void bridge.recordCheckIn({ ...answer, mood }).then(() => ctx.refresh());
  };

  const paint = (): void => {
    render(host,
      h('div', { class: 'hint' }, 'Optional — answer any of these first, then pick how you feel to log it.'),
      q.sleep ? choiceRow('Sleep', CHECK_IN_SLEEP, CHECK_IN_SLEEP_LABELS, () => answer.sleep, (v) => { answer.sleep = v; }) : null,
      q.energy ? choiceRow('Energy', CHECK_IN_ENERGY, CHECK_IN_ENERGY_LABELS, () => answer.energy, (v) => { answer.energy = v; }) : null,
      q.ate
        ? choiceRow('Ate properly', ['yes', 'no'] as const, { yes: 'Yes', no: 'No' },
            () => (answer.ate === undefined ? undefined : answer.ate ? 'yes' : 'no'),
            (v) => { if (v === undefined) delete answer.ate; else answer.ate = v === 'yes'; })
        : null,
      focusTargets.length
        ? choiceRow('Today’s focus', focusTargets.map((t) => t.id), Object.fromEntries(focusTargets.map((t) => [t.id, t.name])),
            () => answer.focusTargetIds?.[0],
            (v) => { if (v === undefined) delete answer.focusTargetIds; else answer.focusTargetIds = [v]; })
        : null,
      h('div', { class: 'check-in-row' },
        h('span', { class: 'hint' }, 'Feeling'),
        h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } },
          ...CHECK_IN_MOODS.map((mood) => button(CHECK_IN_LABELS[mood], { variant: 'soft', onClick: () => record(mood) })),
        ),
      ),
    );
  };
  paint();
  return host;
}
