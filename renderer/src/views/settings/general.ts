import { h } from '../../dom';
import { card, segmented } from '../../components/primitives';
import { inlineLink } from '../../components/inlineLink';
import { breakReminderEditor } from '../../components/breakReminderEditor';
import { readinessSettingsEditor } from '../../components/readinessSettingsEditor';
import { stalenessEditor } from '../../components/stalenessEditor';
import { sessionSettingsEditor } from '../../components/sessionSettingsEditor';
import { gradingSettingsEditor } from '../../components/gradingSettingsEditor';
import { getWinrateScheme, setWinrateScheme } from '../../theme';
import { WINRATE_SCHEME_OPTIONS, type WinrateScheme } from '../../winrateScheme';
import { getDensity, setDensity, DENSITY_OPTIONS, type Density } from '../../density';
import { prefs, DEFAULT_SUGGESTED_HEROES, clampSuggestedHeroCount } from '../../prefs';
import { store, type ViewId } from '../../store';
import type { ViewContext } from '../view';
import { accountsCard } from './accounts';
import { appBehaviorCard } from './appBehavior';
import { diagnosticsCard } from './diagnostics';
import { dataLocationCard } from './dataLocation';
import { importCard } from './importCard';

/** A card the section rail can jump to (W1) — tags `el` with the matching `data-settings-section`. */
function section<T extends HTMLElement>(el: T, key: string): T {
  el.dataset.settingsSection = key;
  return el;
}

/**
 * One labelled block inside the Coaching card (W1): a heading and a one-line
 * hint naming what the control actually affects — the five editors used to
 * just stack with nothing saying which was which — plus a "See it on X →"
 * jump so the player can go look at the thing they just tuned. `jump` is
 * omitted for Quick Log, which affects a modal (Log Match), not a screen
 * `ctx.navigate` can land on.
 */
function coachingBlock(
  ctx: ViewContext,
  opts: { title: string; hint: string; jump?: { label: string; view: ViewId } },
  control: HTMLElement,
): HTMLElement {
  return h('div', { class: 'coaching-block' },
    h('div', { class: 'field-label' }, opts.title),
    h('div', { class: 'hint', style: { marginBottom: '8px' } }, opts.hint),
    control,
    opts.jump
      ? h('div', { style: { marginTop: '6px' } },
          inlineLink(opts.jump.label, { onClick: () => ctx.navigate(opts.jump!.view) }))
      : null,
  );
}

/**
 * Quick Log preferences: how many "most played" heroes the Log Match hero
 * picker shortlists before falling back to search. Client-side only (no
 * bridge round-trip) — the card re-reads the live value each time it opens.
 * Folded into the Coaching card as its first block (W1) — its own standalone
 * card used to be a whole extra screen-height for one number field.
 */
function quickLogBlock(ctx: ViewContext): HTMLElement {
  const value = prefs.get('suggestedHeroCount') ?? DEFAULT_SUGGESTED_HEROES;
  const input = h('input', {
    class: 'vt-input mono', type: 'number', min: '3', max: '15', step: '1',
    value: String(value),
    style: { width: '70px' },
  }) as HTMLInputElement;
  input.addEventListener('change', () => {
    const n = clampSuggestedHeroCount(Number(input.value) || DEFAULT_SUGGESTED_HEROES);
    input.value = String(n);
    prefs.set('suggestedHeroCount', n);
  });
  const el = coachingBlock(ctx, { title: 'Quick Log', hint: 'How many of your most-played heroes the Log Match card suggests before you have to search.' },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
      h('span', { class: 'field-label', style: { margin: '0' } }, 'Suggested heroes shown'),
      input,
    ),
  );
  return section(el, 'quickLog');
}

/** Accounts, Coaching (incl. Quick Log), App Behavior, Appearance, Diagnostics, Data Storage, Import. */
export function generalTab(ctx: ViewContext): HTMLElement {
  return h('div', { class: 'stack', style: { gap: '18px' } },
    section(accountsCard(ctx), 'accounts'),
    h('div', { class: 'grid-2' },
      section(card({ title: 'Coaching', sub: 'nudges and thresholds used across the app' },
        quickLogBlock(ctx),
        coachingBlock(ctx, {
          title: 'Break reminder',
          hint: 'A tray nudge after N losses in a row, so a tilt spiral does not run unnoticed.',
          jump: { label: 'See it on Mental →', view: 'mental' },
        }, breakReminderEditor(ctx)),
        coachingBlock(ctx, {
          title: 'Readiness coach',
          hint: 'The pre-session readiness verdict, and its optional launch-time nudge.',
          jump: { label: 'See it on Readiness →', view: 'readiness' },
        }, readinessSettingsEditor(ctx)),
        coachingBlock(ctx, {
          title: 'Target rotation',
          hint: 'How long an active target can be your focus before it is flagged stale.',
          jump: { label: 'See it on Targets →', view: 'targets' },
        }, stalenessEditor(ctx)),
        coachingBlock(ctx, {
          title: 'Current session',
          hint: 'The gap between games that starts a new sitting, everywhere the app groups by one.',
          jump: { label: 'See it on Matches →', view: 'matches' },
        }, sessionSettingsEditor(ctx)),
        coachingBlock(ctx, {
          title: 'Grading margin',
          hint: 'How close a measured target can miss its threshold and still grade Partial.',
          jump: { label: 'See it on Review →', view: 'review' },
        }, gradingSettingsEditor(ctx)),
      ), 'coaching'),
      section(appBehaviorCard(ctx), 'appBehavior'),
    ),
    h('div', { class: 'grid-2' },
      section(card({ title: 'Appearance' },
        h('div', { style: { marginTop: '4px' } },
          h('div', { class: 'field-label' }, 'Winrate colours'),
          segmented<WinrateScheme>({
            options: [...WINRATE_SCHEME_OPTIONS],
            value: getWinrateScheme(),
            onChange: (scheme) => {
              setWinrateScheme(scheme);
              store.rerender();
            },
          }),
          h('div', { class: 'hint', style: { marginTop: '8px' } },
            'Colours the win / loss / draw stats across every chart and screen. ' +
            'Colorblind uses a blue–orange palette instead of teal–rose.'),
        ),
        h('div', { style: { marginTop: '14px' } },
          h('div', { class: 'field-label' }, 'Density'),
          segmented<Density>({
            options: [...DENSITY_OPTIONS],
            value: getDensity(),
            onChange: (density) => setDensity(density),
          }),
          h('div', { class: 'hint', style: { marginTop: '8px' } },
            'Compact tightens row and card padding across tables and lists, for more on screen at once.'),
        ),
      ), 'appearance'),
      section(diagnosticsCard(), 'diagnostics'),
    ),
    section(dataLocationCard(), 'dataStorage'),
    section(importCard(), 'import'),
  );
}
