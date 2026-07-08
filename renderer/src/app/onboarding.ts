/**
 * First-time user experience — a short guided tour. Runs once on first launch
 * (gated by a localStorage flag) and is re-openable from Help in the status bar.
 * Built on the same centered-overlay look as the other modals, but manages its
 * own step state so the user can page Back / Next / Finish.
 */
import { h, render } from '../dom';
import { button } from '../components/primitives';

const KEY = 'vantageOnboarded';
const SUPPORT = 'timo.seikel@gmail.com';

interface Step {
  title: string;
  lead?: string;
  points?: Array<[string, string]>;
  note?: string;
}

const STEPS: Step[] = [
  {
    title: 'Welcome to Vantage',
    lead:
      'Your Overwatch stats coach. Vantage turns your match history into priority maps, exact ' +
      'per-hero stats, mental tracking and improvement targets — so you can see where the points are hiding.',
    note:
      'Account-safe by design: it uses only Overwolf’s official Game Events Provider — the same ' +
      'sanctioned feed other apps use. It never reads game memory or injects anything.',
  },
  {
    title: 'You’re seeing demo data',
    lead:
      'Until real games flow in, the dashboard shows a realistic demo dataset — look for the ' +
      '“Demo data” badge in the status bar. Your own games replace it automatically once tracking starts.',
  },
  {
    title: 'Your workspace',
    points: [
      ['Overview', 'KPIs, the winrate × volume scatter, and your focus queue at a glance.'],
      ['Review', 'Add the human read to recent games — how they actually felt.'],
      ['Matches', 'Your recent game log.'],
      ['Maps', 'Winrate by game mode, then every map ranked best → worst.'],
      ['Heroes', 'The exact per-hero table with a click-through drill-down.'],
    ],
  },
  {
    title: 'Insights',
    points: [
      ['Focus', 'Net-losing maps ranked by deficit — what to work on first.'],
      ['Mental', 'Tilt / comms tracking and the tax tilt puts on your winrate.'],
      ['Trends', 'Winrate over time, split by role, mode and account.'],
      ['Targets', 'Build an improvement target and see if hitting it moves your winrate.'],
    ],
  },
  {
    title: 'Log a match in seconds',
    lead:
      'Press Ctrl K anytime to log a match — result, map, role, hero and how it felt. The tilt / ' +
      'comms flags you add feed straight into the Mental view.',
  },
  {
    title: 'Sync to Notion (optional)',
    lead:
      'On the Notion sync screen, connect a Notion database to export your tracked games with one click. ' +
      'It’s deduped by match, so re-syncing never double-writes.',
  },
  {
    title: 'You’re all set',
    lead:
      `That’s the tour. Questions or feedback? Reach support at ${SUPPORT}. ` +
      'You can replay this tour anytime from Help in the status bar.',
  },
];

/** Step 2 reflects the actual data mode: demo season vs. a fresh start. */
function demoStep(demoActive: boolean): Step {
  return demoActive
    ? {
        title: 'You’re seeing demo data',
        lead:
          'You chose to explore with a realistic demo dataset — look for the “Demo data” badge in the ' +
          'status bar. Your own games replace it automatically once tracking starts, and you can turn ' +
          'demo data off anytime in Settings.',
      }
    : {
        title: 'You’re starting fresh',
        lead:
          'No demo data and no fabricated targets — every screen starts empty and fills in with your own ' +
          'games and targets as you track them. Prefer to explore with sample data first? Turn demo data ' +
          'on anytime in Settings.',
      };
}

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

export function openOnboarding(demoActive = false): void {
  // Step 2 is computed per demo/fresh mode; the rest are static.
  const steps = STEPS.map((s, n) => (n === 1 ? demoStep(demoActive) : s));
  const panel = h('div', { class: 'modal-card', style: { width: '520px', maxWidth: '92vw' } });
  const overlay = h('div', { class: 'overlay overlay--center' }, panel);
  let i = 0;

  const close = (): void => {
    window.removeEventListener('keydown', onKey);
    overlay.remove();
  };
  const finish = (): void => {
    markDone();
    close();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') finish();
    else if (e.key === 'ArrowRight' && i < steps.length - 1) go(i + 1);
    else if (e.key === 'ArrowLeft' && i > 0) go(i - 1);
  };
  const go = (n: number): void => {
    i = n;
    draw();
  };

  panel.addEventListener('click', (e) => e.stopPropagation());
  window.addEventListener('keydown', onKey);

  const dots = (): HTMLElement =>
    h('div', { style: { display: 'flex', gap: '5px' } },
      ...steps.map((_, n) =>
        h('span', {
          style: {
            width: '6px', height: '6px', borderRadius: '50%',
            background: n === i ? 'var(--accent)' : 'var(--surface-3)',
          },
        }),
      ),
    );

  const stepBody = (s: Step): HTMLElement =>
    h('div', { class: 'stack', style: { gap: '12px' } },
      s.lead ? h('div', { style: { fontSize: '13.5px', lineHeight: '1.55', color: 'var(--text-2)' } }, s.lead) : null,
      s.points
        ? h('div', { class: 'stack', style: { gap: '9px' } },
            ...s.points.map(([label, desc]) =>
              h('div', { style: { display: 'flex', gap: '10px', alignItems: 'baseline' } },
                h('span', { class: 'is-accent', style: { fontSize: '12.5px', fontWeight: '600', width: '74px', flex: '0 0 auto' } }, label),
                h('span', { style: { fontSize: '12.5px', color: 'var(--text-2)', lineHeight: '1.5' } }, desc),
              ),
            ),
          )
        : null,
      s.note ? h('div', { class: 'hint', style: { lineHeight: '1.5' } }, s.note) : null,
    );

  const draw = (): void => {
    const s = steps[i];
    const last = i === steps.length - 1;
    render(panel,
      h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border)' } },
        h('div', { style: { fontFamily: 'var(--font-head)', fontSize: '16px', fontWeight: '600' } }, s.title),
        h('button', { class: 'overlay-close', title: 'Skip', on: { click: finish } }, '✕'),
      ),
      h('div', { style: { padding: '20px' } }, stepBody(s)),
      h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderTop: '1px solid var(--border)' } },
        dots(),
        h('div', { style: { display: 'flex', gap: '10px' } },
          i > 0 ? button('Back', { class: 'btn--ghost', onClick: () => go(i - 1) }) : null,
          last
            ? button('Get started', { variant: 'primary', onClick: finish })
            : button('Next', { variant: 'primary', onClick: () => go(i + 1) }),
        ),
      ),
    );
  };

  document.body.appendChild(overlay);
  draw();
}
