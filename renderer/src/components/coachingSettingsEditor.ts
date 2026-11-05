/**
 * The practice-focus editor (Settings › Coaching, issue #321): whether Mental
 * and Review lead with your targets, which optional check-in questions are
 * asked, how long a focus choice sticks on Review, and how breaks between
 * games are detected. Applies immediately and re-renders, no toast — same as
 * the other Coaching editors.
 */
import { h } from '../dom';
import type { CoachingSettings } from '../../../src/shared/contract';
import { bridge } from '../bridge';
import { fieldLabel, segmented, toggleRow } from './primitives';
import { infoTip } from './infoTip';
import type { ViewContext } from '../views/view';

const BREAK_PRESETS = [5, 10, 15, 20, 30];

export function coachingSettingsEditor(ctx: ViewContext): HTMLElement {
  const s = ctx.data.coachingSettings;
  const set = (patch: Partial<CoachingSettings>): void => {
    void bridge.setCoaching({ ...s, ...patch }).then(() => ctx.refresh());
  };
  const question = (key: keyof CoachingSettings['checkInQuestions'], label: string, hint: string): HTMLElement =>
    toggleRow({
      label, hint, on: s.checkInQuestions[key],
      onChange: (on) => set({ checkInQuestions: { ...s.checkInQuestions, [key]: on } }),
    });
  const row = (label: string, control: HTMLElement, info?: string): HTMLElement =>
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } },
      h('span', { class: 'hint' }, label, info ? infoTip(info, { label: `About ${label}` }) : null), control);

  return h('div', { class: 'stack', style: { gap: '12px', marginTop: '12px' } },
    row('Practice focus', segmented({
      options: [
        { value: 'auto', label: 'Auto' },
        { value: 'on', label: 'Always on' },
        { value: 'off', label: 'Off — stats only' },
      ],
      value: s.practiceFocus,
      onChange: (practiceFocus) => set({ practiceFocus }),
    }), 'Auto turns it on while you have active targets: Mental and Review then lead with “did I do what I planned?”, '
      + 'and win/loss becomes the small print.'),
    // Training session mode (issue #342): the switch itself lives in the
    // sidebar / Matches header; only its opt-in auto-reset is a setting.
    h('div', { class: 'field-label', style: { marginTop: '4px', display: 'flex', alignItems: 'center', gap: '6px' } },
      'Training mode',
      infoTip('Training is a session mode you switch on in the sidebar’s Current session card or the Matches header. '
        + 'Matches played while it is on show how well you executed your targets instead of win/loss; '
        + 'the result is still tracked for rank, readiness and Trends.', { label: 'What is Training mode?' })),
    toggleRow({
      label: 'Switch back to Stats when a new sitting starts',
      hint: 'A new sitting starts after a pause longer than the Current session gap. Off: Training stays on until you switch it off.',
      on: s.trainingAutoReset,
      onChange: (trainingAutoReset) => set({ trainingAutoReset }),
    }),
    row('Keep a focus target for', segmented({
      options: [
        { value: 'game', label: 'this game' },
        { value: 'sitting', label: 'this sitting' },
        { value: 'sticky', label: 'until I change it' },
      ],
      value: s.focusStickiness,
      onChange: (focusStickiness) => set({ focusStickiness }),
    })),
    row('Breaks between games', segmented({
      options: [{ value: 'auto', label: 'Detect automatically' }, { value: 'manual', label: 'I mark them' }],
      value: s.breakDetection,
      onChange: (breakDetection) => set({ breakDetection }),
    })),
    s.breakDetection === 'auto'
      ? row('A break is a pause of at least', segmented({
          options: BREAK_PRESETS.map((m) => ({ value: String(m), label: `${m} min` })),
          value: String(s.breakMinutes),
          onChange: (v) => set({ breakMinutes: Number(v) }),
        }))
      : null,
    fieldLabel('Extra check-in questions',
      'Optional, and only ever compared with your own performance on Mental — they never change the Readiness score.',
      { style: { marginTop: '4px', marginBottom: '0' } }),
    question('sleep', 'Sleep', 'Poor / OK / Good'),
    question('energy', 'Energy', 'Foggy / OK / Sharp'),
    question('ate', 'Ate properly', 'Yes / No'),
  );
}
