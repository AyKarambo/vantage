/**
 * First-time user experience — a short guided tour. Runs once on first launch
 * (gated by a localStorage flag) and is re-openable from Help in the status
 * bar or the FAQ screen. Four steps (F5, down from seven): welcome + the
 * account-safety note, "Your workspace" (which also folds in the demo-data
 * choice on a genuine first run — asked once, in place, rather than a
 * separate blocking prompt immediately followed by this tour restating the
 * same choice), the log/review loop, and Notion + support. Built on
 * `openModal` (shared focus trap / Tab order); Escape and ✕ both just skip
 * the tour, same as before — a demo choice left unmade this way reads as
 * `'off'` functionally (`effectiveDemo`, `src/core/demoPreference.ts`) and is
 * fully recoverable from Settings any time.
 */
import { h, render } from '../dom';
import { button } from '../components/primitives';
import { openModal } from '../components/overlay';
import { bridge } from '../bridge';
import { store } from '../store';

const KEY = 'vantageOnboarded';
/** Until `getAppInfo()` resolves — same fallback `about.ts` uses. */
const FALLBACK_SUPPORT_EMAIL = 'timo.seikel@gmail.com';

/**
 * One line per screen, grouped the way the sidebar is (K6). Hand-kept in step
 * with `shell.ts`'s `NAV` rather than generated from it: the tour needs a
 * blurb per screen that `NavItem` itself doesn't carry, and NAV's `App` group
 * (Notion sync, Logs, Settings, About, FAQ) isn't "your workspace" — Notion
 * gets its own step below, the rest are about the app rather than your
 * stats, and none of the four belong crowded into one already-dense step.
 */
const WORKSPACE: Array<{ group: string; items: Array<[string, string]> }> = [
  {
    group: 'Now',
    items: [
      ['Overview', 'KPIs, the winrate × volume scatter, and your top priorities at a glance.'],
      ['Live', 'The match you’re in right now, while it’s running.'],
    ],
  },
  {
    group: 'After the session',
    items: [
      ['Review', 'Add the human read to recent games — how they actually felt.'],
      ['Matches', 'Your recent game log.'],
      ['Players', 'Everyone you’ve met, with your record together.'],
    ],
  },
  {
    group: 'Improve',
    items: [
      ['Focus', 'The maps, heroes and roles that cost you the most — what to work on first.'],
      ['Targets', 'Build an improvement target and see if hitting it moves your winrate.'],
      ['Mental', 'Tilt / comms tracking and the tax tilt puts on your winrate.'],
      ['Readiness', 'Whether tonight looks like a good night to climb.'],
    ],
  },
  {
    group: 'Reference',
    items: [
      ['Heroes', 'The exact per-hero table with a click-through drill-down.'],
      ['Maps', 'Winrate by game mode, then every map ranked best → worst.'],
      ['Trends', 'Winrate over time, split by role, mode and account.'],
    ],
  },
];

const STEP_TITLES = ['Welcome to Vantage', 'Your workspace', 'Log a match in seconds', 'Sync to Notion (optional)'];
const STEP_COUNT = STEP_TITLES.length;

/** True when the tour hasn’t been completed yet. */
export function shouldOnboard(): boolean {
  try {
    return localStorage.getItem(KEY) !== '1';
  } catch {
    return false;
  }
}

function markDone(): void {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    /* storage unavailable — the tour will just show again next launch */
  }
}

function workspaceGrid(): HTMLElement {
  return h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' } },
    ...WORKSPACE.map((section) =>
      h('div', null,
        h('div', { class: 'u-dim', style: { fontSize: '10.5px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' } }, section.group),
        h('div', { class: 'stack', style: { gap: '7px' } },
          ...section.items.map(([label, desc]) =>
            h('div', { style: { display: 'flex', gap: '8px', alignItems: 'baseline' } },
              h('span', { class: 'is-accent', style: { fontSize: '12px', fontWeight: '600', width: '58px', flex: '0 0 auto' } }, label),
              h('span', { style: { fontSize: '11.5px', color: 'var(--text-2)', lineHeight: '1.4' } }, desc),
            ),
          ),
        ),
      ),
    ),
  );
}

/**
 * @param offerDemoChoice True only on a genuine first run (`demoPreference`
 *   still `'unset'`) — step 2 swaps its Next button for the demo-choice pair.
 *   A replay (Help menu, FAQ) always passes `false`: the choice is already
 *   made, so step 2 is just the workspace rundown with normal navigation —
 *   the status bar's "Demo data" badge is the persistent, always-visible
 *   answer to "am I looking at real games", so the tour doesn't restate it.
 */
export function openOnboarding(offerDemoChoice = false): void {
  let i = 0;
  let choosingDemo = offerDemoChoice;
  let supportEmail = FALLBACK_SUPPORT_EMAIL;
  const body = h('div');

  void bridge.getAppInfo().then((info) => {
    supportEmail = info.supportEmail;
    if (i === STEP_COUNT - 1) draw();
  });

  const finish = (): void => {
    markDone();
    handle.close();
  };
  const go = (n: number): void => { i = n; draw(); };

  const chooseDemo = (pref: 'on' | 'off'): void => {
    choosingDemo = false;
    void bridge.setAppSettings({ demoPreference: pref }).then(() => store.refresh()).then(() => go(2));
  };

  const dots = (): HTMLElement =>
    h('div', { style: { display: 'flex', gap: '5px' } },
      ...Array.from({ length: STEP_COUNT }, (_, n) =>
        h('span', {
          style: {
            width: '6px', height: '6px', borderRadius: '50%',
            background: n === i ? 'var(--accent)' : 'var(--surface-3)',
          },
        }),
      ),
    );

  const stepBody = (n: number): Node => {
    if (n === 0) {
      return h('div', { class: 'stack', style: { gap: '12px' } },
        h('div', { style: { fontSize: '13.5px', lineHeight: '1.55', color: 'var(--text-2)' } },
          'Your Overwatch stats coach. Vantage turns your match history into priority maps, exact ' +
          'per-hero stats, mental tracking and improvement targets — so you can see where the points are hiding.'),
        h('div', { class: 'hint', style: { lineHeight: '1.5' } },
          'Account-safe by design: it uses only Overwolf’s official Game Events Provider — the same ' +
          'sanctioned feed other apps use. It never reads game memory or injects anything.'),
      );
    }
    if (n === 1) {
      return h('div', { class: 'stack', style: { gap: '12px' } },
        choosingDemo
          ? h('div', { style: { fontSize: '13.5px', lineHeight: '1.55', color: 'var(--text-2)' } },
              'Want to explore with a realistic demo dataset first, or start fresh and track your own games ' +
              'right away? You can change this anytime in Settings.')
          : null,
        workspaceGrid(),
      );
    }
    if (n === 2) {
      return h('div', { class: 'stack', style: { gap: '12px' } },
        h('div', { style: { fontSize: '13.5px', lineHeight: '1.55', color: 'var(--text-2)' } },
          'Press Ctrl L anytime to log a match — result, map, role, hero and how it felt (Ctrl K finds it too). ' +
          'Add the human read afterward on Review — how the game actually went — and the tilt / comms flags ' +
          'you add there feed straight into the Mental view.'),
      );
    }
    return h('div', { class: 'stack', style: { gap: '12px' } },
      h('div', { style: { fontSize: '13.5px', lineHeight: '1.55', color: 'var(--text-2)' } },
        'On the Notion sync screen, connect a Notion database to export your tracked games with one click. ' +
        'It’s deduped by match, so re-syncing never double-writes.'),
      h('div', { class: 'hint', style: { lineHeight: '1.5' } },
        `Questions or feedback? Reach support at ${supportEmail}. You can replay this tour anytime from Help ` +
        'in the status bar.'),
    );
  };

  const footer = (): HTMLElement => {
    if (i === 1 && choosingDemo) {
      return h('div', { style: { display: 'flex', gap: '10px' } },
        button('Show me demo data', { variant: 'primary', onClick: () => chooseDemo('on') }),
        button('Start fresh', { variant: 'soft', onClick: () => chooseDemo('off') }),
      );
    }
    const last = i === STEP_COUNT - 1;
    return h('div', { style: { display: 'flex', gap: '10px' } },
      i > 0 ? button('Back', { class: 'btn--ghost', onClick: () => go(i - 1) }) : null,
      last
        ? button('Get started', { variant: 'primary', onClick: finish })
        : button('Next', { variant: 'primary', onClick: () => go(i + 1) }),
    );
  };

  const draw = (): void => {
    render(body,
      h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border)' } },
        h('div', { style: { fontFamily: 'var(--font-head)', fontSize: '16px', fontWeight: '600' } }, STEP_TITLES[i]),
        h('button', { class: 'overlay-close', title: 'Skip', on: { click: finish } }, '✕'),
      ),
      h('div', { style: { padding: '20px' } }, stepBody(i)),
      h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderTop: '1px solid var(--border)' } },
        dots(),
        footer(),
      ),
    );
  };

  const handle = openModal(() => body, { panelClass: 'modal-card--onboarding' });
  draw();
}
