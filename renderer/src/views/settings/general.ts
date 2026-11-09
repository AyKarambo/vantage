import { h } from '../../dom';
import { card, fieldLabel, segmented } from '../../components/primitives';
import { inlineLink } from '../../components/inlineLink';
import { breakReminderEditor } from '../../components/breakReminderEditor';
import { readinessSettingsEditor } from '../../components/readinessSettingsEditor';
import { stalenessEditor } from '../../components/stalenessEditor';
import { sessionSettingsEditor } from '../../components/sessionSettingsEditor';
import { coachingSettingsEditor } from '../../components/coachingSettingsEditor';
import { gradingSettingsEditor } from '../../components/gradingSettingsEditor';
import { getWinrateScheme, setWinrateScheme } from '../../theme';
import { WINRATE_SCHEME_OPTIONS, type WinrateScheme } from '../../winrateScheme';
import { getDensity, setDensity, DENSITY_OPTIONS, type Density } from '../../density';
import { prefs, DEFAULT_SUGGESTED_HEROES, clampSuggestedHeroCount } from '../../prefs';
import { store, type ViewId } from '../../store';
import type { ViewContext } from '../view';
import { proCard } from './pro';
import { developerCard } from './developer';
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
 * One labelled block inside the Coaching card (W1): a heading whose ⓘ names
 * what the control actually affects (#339 — it used to be an always-visible
 * hint line under every heading) — the five editors used to just stack with
 * nothing saying which was which — plus a "See it on X →" jump so the player
 * can go look at the thing they just tuned. `jump` is omitted for Quick Log,
 * which affects a modal (Log Match), not a screen `ctx.navigate` can land on.
 */
function coachingBlock(
  ctx: ViewContext,
  opts: { title: string; info: string; jump?: { label: string; view: ViewId } },
  control: HTMLElement,
): HTMLElement {
  return h('div', { class: 'coaching-block' },
    fieldLabel(opts.title, opts.info),
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
  const el = coachingBlock(ctx, { title: 'Quick Log', info: 'How many of your most-played heroes the Log Match card suggests before you have to search.' },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
      h('span', { class: 'field-label', style: { margin: '0' } }, 'Suggested heroes shown'),
      input,
    ),
  );
  return section(el, 'quickLog');
}

/** Accounts, Coaching (incl. Quick Log), App Behavior, Appearance, Diagnostics, Data Storage, Import. */
export function generalTab(ctx: ViewContext): HTMLElement {
  const full = ctx.data.pro.full;
  return h('div', { class: 'stack', style: { gap: '18px' } },
    // Dev builds only: the release bundle compiles this branch (and developer.ts) out.
    __DEV_TOOLS__ ? section(developerCard(ctx), 'developer') : null,
    section(proCard(ctx), 'pro'),
    section(accountsCard(ctx), 'accounts'),
    h('div', { class: 'grid-2' },
      section(card({
        title: 'Coaching',
        info: 'Nudges and thresholds used across the app. Each block links to the screen it changes.',
      },
        quickLogBlock(ctx),
        coachingBlock(ctx, {
          title: full ? 'Practice focus' : 'Check-ins and breaks',
          info: full
            ? 'Lead Mental and Review with your targets, the optional check-in questions, and how breaks are read.'
            : 'The optional check-in questions, and how breaks are read.',
          // Mental is Pro (#337): no jump into a lock page from a free setting.
          ...(full ? { jump: { label: 'See it on Mental →', view: 'mental' as const } } : {}),
        }, coachingSettingsEditor(ctx, { proFocus: full })),
        coachingBlock(ctx, {
          title: 'Break reminder',
          info: 'A tray nudge after N losses in a row, so a tilt spiral does not run unnoticed.',
          // Mental is Pro (#337): no jump into a lock page from a free setting.
          ...(full ? { jump: { label: 'See it on Mental →', view: 'mental' as const } } : {}),
        }, breakReminderEditor(ctx)),
        full ? coachingBlock(ctx, {
          title: 'Readiness coach',
          info: 'The pre-session readiness verdict, and its optional launch-time nudge.',
          jump: { label: 'See it on Readiness →', view: 'readiness' },
        }, readinessSettingsEditor(ctx)) : null,
        full ? coachingBlock(ctx, {
          title: 'Target rotation',
          info: 'How long an active target can be your focus before it is flagged stale.',
          jump: { label: 'See it on Targets →', view: 'targets' },
        }, stalenessEditor(ctx)) : null,
        coachingBlock(ctx, {
          title: 'Current session',
          info: 'The gap between games that starts a new sitting, everywhere the app groups by one.',
          jump: { label: 'See it on Matches →', view: 'matches' },
        }, sessionSettingsEditor(ctx)),
        full ? coachingBlock(ctx, {
          title: 'Grading margin',
          info: 'How close a measured target can miss its threshold and still grade Partial.',
          jump: { label: 'See it on Review →', view: 'review' },
        }, gradingSettingsEditor(ctx)) : null,
      ), 'coaching'),
      section(appBehaviorCard(ctx), 'appBehavior'),
    ),
    h('div', { class: 'grid-2' },
      section(card({ title: 'Appearance' },
        h('div', { style: { marginTop: '4px' } },
          fieldLabel('Winrate colours',
            'Colours the win / loss / draw stats across every chart and screen. '
            + 'Colorblind uses a blue–orange palette instead of teal–rose.'),
          segmented<WinrateScheme>({
            options: [...WINRATE_SCHEME_OPTIONS],
            value: getWinrateScheme(),
            onChange: (scheme) => {
              setWinrateScheme(scheme);
              store.rerender();
            },
          }),
        ),
        h('div', { style: { marginTop: '14px' } },
          fieldLabel('Density',
            'Compact tightens row and card padding across tables and lists, for more on screen at once.'),
          segmented<Density>({
            options: [...DENSITY_OPTIONS],
            value: getDensity(),
            onChange: (density) => setDensity(density),
          }),
        ),
      ), 'appearance'),
      section(diagnosticsCard(), 'diagnostics'),
    ),
    section(dataLocationCard(), 'dataStorage'),
    section(importCard(), 'import'),
  );
}
