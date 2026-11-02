/**
 * Vantage Pro surfaces (#337): the lock page a Pro screen opens on without
 * access, the banner over a demo preview, and the shared purchase buttons.
 * The lock page is the only place the app asks for an upgrade — no popups in
 * the game flow.
 */
import { h } from '../dom';
import type { ProAccess, ProAction } from '../../../src/shared/contract';
import { bridge } from '../bridge';
import { button, card } from './primitives';
import { toast } from './toast';
import { purchaseAvailable, type ProView } from '../proAccess';
import { viewHead, type ViewContext } from '../views/view';

const COPY: Record<ProView, { title: string; sub: string; points: string[] }> = {
  readiness: {
    title: 'Readiness',
    sub: 'Should you queue right now? A daily read on fatigue, form and tilt.',
    points: [
      'One verdict per day — fresh, steady, loaded or in the hole — with the reasons behind it',
      'Spots grinding streaks and form dips before they cost you rank',
      'Built from the matches and check-ins you already track',
    ],
  },
  mental: {
    title: 'Mental',
    sub: 'What tilt, sleep and breaks actually cost you, measured on your own games.',
    points: [
      'Tilt tax: your win rate calm vs tilted, per session position, map and time of day',
      'How check-ins (mood, sleep, energy) line up with how you play',
      'Practice view: are you executing what you set out to work on?',
    ],
  },
  targets: {
    title: 'Targets',
    sub: 'Turn "play better" into concrete habits you grade game by game.',
    points: [
      'Self-rated and auto-measured targets, scoped to a hero, role or map',
      'Grade them in Review and Log Match; see the hit rate and the learning curve',
      'Live briefing reminds you of today’s focus before each game',
    ],
  },
};

/** The lock page a Pro screen renders in place of itself. */
export function proLockView(ctx: ViewContext, view: ProView, opts: { onPreview(): void }): HTMLElement {
  const copy = COPY[view];
  const access = ctx.data.pro;
  const lapsed = access.tier === 'lapsed';
  return h('div', { class: 'view' },
    viewHead(copy.title, h('span', null, copy.sub, ' ', proBadge())),
    card({ variant: 'glow', class: 'pro-lock' },
      h('div', { class: 'pro-lock-head' }, `${copy.title} is part of Vantage Pro`),
      h('ul', { class: 'pro-lock-points' }, ...copy.points.map((p) => h('li', null, p))),
      h('div', { class: 'hint' },
        lapsed
          ? 'Your Pro data is still here — nothing was deleted. Renew and it’s back exactly as you left it.'
          : 'Your tracked matches and check-ins already count: start Pro and this screen fills from your history right away.'),
      h('div', { class: 'pro-lock-actions' },
        button('View with demo data', { variant: 'soft', onClick: opts.onPreview }),
        ...purchaseButtons(access),
      ),
      purchaseHint(access),
    ),
  );
}

/** Start trial / Upgrade (or Renew) — disabled with a "coming soon" note while no purchase source exists. */
export function purchaseButtons(access: ProAccess): HTMLElement[] {
  const available = purchaseAvailable(access);
  const out: HTMLElement[] = [];
  if (access.tier === 'free') out.push(actionButton('Start 14-day trial', 'startTrial', 'primary', available));
  out.push(actionButton(access.tier === 'lapsed' ? 'Renew Pro' : 'Upgrade · €1.49/mo', 'upgrade', access.tier === 'free' ? 'ghost' : 'primary', available));
  return out;
}

/** The "coming soon" note under the purchase buttons, when they're disabled. */
export function purchaseHint(access: ProAccess): HTMLElement | null {
  return purchaseAvailable(access)
    ? null
    : h('div', { class: 'hint pro-lock-soon' }, 'Purchases open soon — Vantage Pro is being connected to your Overwolf account.');
}

function actionButton(label: string, kind: ProAction, variant: 'primary' | 'ghost', enabled: boolean): HTMLElement {
  return button(label, {
    variant,
    disabled: !enabled,
    title: enabled ? undefined : 'Coming soon',
    onClick: () => void runProAction(kind),
  });
}

/** Ask main to start a trial / open checkout / manage; a refetch picks up any tier change. */
export async function runProAction(kind: ProAction): Promise<void> {
  try {
    const res = await bridge.proAction(kind);
    if (!res.ok) toast(res.reason === 'unavailable' ? 'Vantage Pro purchases open soon.' : res.message ?? 'That didn’t work — try again in a moment.');
  } catch {
    toast('That didn’t work — try again in a moment.');
  }
}

/** The small "PRO" pill used next to locked titles. */
export function proBadge(): HTMLElement {
  return h('span', { class: 'badge badge--pro', title: 'Part of Vantage Pro' }, 'PRO');
}

/** The strip above a demo preview: what you're looking at, and the way out. */
export function proPreviewBanner(onExit: () => void): HTMLElement {
  return h('div', { class: 'pro-preview-banner' },
    h('span', null, proBadge(), ' Demo preview — sample data, not yours. Vantage Pro shows this for your own games.'),
    button('Exit preview', { variant: 'ghost', onClick: onExit }),
  );
}
