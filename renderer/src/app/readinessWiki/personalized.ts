/**
 * "Your readiness right now" — the personalized walkthrough. Narrates the user's
 * current regime/band/confidence, rebuilds their score from the 75 anchor using
 * each family's actual delta, and points at the scenarios they're closest to.
 *
 * The DISABLED-feature gate is caller-side HERE (a ReadinessSummary can't express
 * "disabled"); the pure `deriveWalkthrough`/`matchScenarios` handle only the
 * data-suppressed states. Either way it degrades to honest generic content —
 * never a fabricated walkthrough (AC7).
 */
import { h } from '../../dom';
import { deriveWalkthrough, matchScenarios } from '../../../../src/core/readiness';
import type { ReadinessBand, ReadinessRegime, ReadinessSummary, FamilyPull, WalkthroughDerivation } from '../../../../src/core/readiness';
import { statBox } from '../../components/primitives';
import { wikiPara, wikiHeading, wikiLink } from './ui';
import { scenarioTile } from './scenarioLibrary';
import { articleById } from './articles';
import type { WikiNav } from './types';
import type { ViewContext } from '../../views/view';

const BAND_LABEL: Record<ReadinessBand, string> = {
  fresh: 'Fresh',
  steady: 'Steady',
  loaded: 'Loaded',
  'in-the-hole': 'In the hole',
  recovering: 'Recovering',
  rusty: 'Rusty',
  'insufficient-data': 'Not enough data',
};

const REGIME_LABEL: Record<ReadinessRegime, string> = {
  stats: 'your live match stats',
  hybrid: 'a blend of live stats and your manual logs',
  manual: 'your manual logs',
};

/** One-decimal signed delta, e.g. +2.5 / −16 / 0. */
function sd(n: number): string {
  const r = Math.round(n * 10) / 10;
  return `${r > 0 ? '+' : ''}${r}`;
}

/** A plain sentence for one family's pull, or null when it's flat. */
function pullPhrase(p: FamilyPull): string | null {
  if (p.direction === 'flat') return null;
  const up = p.direction === 'up';
  switch (p.family) {
    case 'load':
      return up ? 'rest and rhythm are lifting it' : 'your training load is weighing it down';
    case 'performance':
      return up ? 'your results are above your usual' : 'your results are dipping below your usual';
    case 'subjective':
      return up ? 'you’re rating your own play well' : 'tilt or low self-ratings are dragging it';
  }
}

/** The generic, honest fallback shown when there is no personal walkthrough. */
function fallback(nav: WikiNav, reason: string): HTMLElement {
  return h('div', null,
    h('div', { class: 'wiki-title' }, 'Your readiness right now'),
    wikiPara(h('span', { class: 'hint' }, reason)),
    wikiHeading('In the meantime — what the verdict means'),
    articleById('verdict').plain(nav),
    wikiPara(wikiLink('Browse the full guide →', () => nav.home())),
  );
}

export function personalizedArticle(ctx: ViewContext, nav: WikiNav): HTMLElement {
  // Disabled is caller-gated: the summary would still carry a real score.
  if (!ctx.data.readinessSettings.enabled) {
    return fallback(nav, 'The readiness coach is turned off. Turn it on in Settings to get a personalized read of your training load and recovery.');
  }

  const summary: ReadinessSummary = ctx.data.readiness;
  const walkthrough = deriveWalkthrough(summary);
  if (!walkthrough) {
    const reason =
      summary.score === null || summary.band === 'insufficient-data'
        ? 'Keep logging games to unlock a personalized readiness read.'
        : 'Log your mental state after games, or rate your play, to sharpen the read enough to break it down for you.';
    return fallback(nav, reason);
  }

  const { narrative, reconstruction } = walkthrough;
  const match = matchScenarios(summary);

  const pulls = narrative.pulls.map(pullPhrase).filter((p): p is string => p !== null);
  const pullSentence = pulls.length ? `Right now, ${joinPhrases(pulls)}.` : 'Right now every family is roughly neutral.';

  const op = (t: string): HTMLElement => h('span', { class: 'u-dim', style: { fontSize: '14px', fontWeight: '600' } }, t);
  const note = reconstructionNote(reconstruction);

  return h('div', null,
    h('div', { class: 'wiki-title' }, 'Your readiness right now'),
    wikiPara(
      `You’re reading `, h('b', null, BAND_LABEL[narrative.band]),
      `, built from ${REGIME_LABEL[narrative.regime]} at ${narrative.confidence} confidence. ${pullSentence}`,
    ),

    wikiHeading('How your score is built'),
    wikiPara(h('span', { class: 'hint' }, 'Everyone starts at 75; each family nudges it from there.')),
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', margin: '4px 0 6px' } },
      statBox('75', 'start'),
      statBox(sd(reconstruction.deltas.load), 'load'),
      statBox(sd(reconstruction.deltas.performance), 'results'),
      statBox(sd(reconstruction.deltas.subjective), 'self-report'),
      op('→'),
      statBox(String(reconstruction.shown), 'your score'),
    ),
    note ? wikiPara(h('span', { class: 'hint' }, note)) : null,

    ...(match
      ? [
          wikiHeading('You’re closest to'),
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
            scenarioTile(match.primary.scenario, { closest: true }),
            ...match.alternates.map((a) => scenarioTile(a.scenario)),
          ),
          wikiPara(wikiLink('See all player scenarios →', () => nav.goto({ view: 'scenarios' }))),
        ]
      : []),
  );
}

/** "a, b and c" from a list of phrases. */
function joinPhrases(parts: string[]): string {
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** Explains why the displayed pieces may not sum to the shown score — a 0/100 cap or rounding. */
function reconstructionNote(rec: WalkthroughDerivation['reconstruction']): string | null {
  if (rec.clamped === 'low') return 'Readiness never drops below 0, so the pieces below add up past the floor.';
  if (rec.clamped === 'high') return 'Readiness is capped at 100, so the pieces add up past the ceiling.';
  if (rec.roundingResidual !== 0) return 'The pieces are each rounded, so the total can land a point off their sum.';
  return null;
}
