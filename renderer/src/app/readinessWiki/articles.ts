/**
 * The four wiki articles — one per data card on the Readiness view. Each is
 * simple-first: a plain intro, then "how it works", then a deep dive that quotes
 * the real mechanics via {@link deepCopy}. Pure content builders; the host wraps
 * them with the breadcrumb + tier toggle and injects `nav`.
 */
import { h } from '../../dom';
import { PALETTE } from '../../theme';
import { supercompensationSchematic } from '../../charts/plots';
import { deepCopy } from './deepCopy';
import { wikiPara, wikiHeading, wikiLink } from './ui';
import type { WikiArticle, WikiArticleId, WikiNav } from './types';

/** The verdict bands, plain-language — mirrors the view's traffic-light read. */
const BANDS: Array<{ label: string; color: string; note: string }> = [
  { label: 'Fresh', color: PALETTE.win, note: 'rested and good to go' },
  { label: 'Steady', color: PALETTE.win, note: 'in rhythm — nothing flagged' },
  { label: 'Loaded', color: PALETTE.mid, note: 'heavy load — ease up soon' },
  { label: 'In the hole', color: PALETTE.loss, note: 'grinding with real warning signs — rest' },
  { label: 'Recovering', color: PALETTE.accentBright, note: 'readiness rebuilding after rest' },
  { label: 'Rusty', color: PALETTE.info, note: 'a long layoff — sharpness fading' },
];

function bandList(): HTMLElement {
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '7px', margin: '4px 0 6px' } },
    ...BANDS.map((b) => h('div', { style: { display: 'flex', alignItems: 'center', gap: '9px' } },
      h('span', { style: { width: '10px', height: '10px', borderRadius: '50%', background: b.color, flex: '0 0 auto' } }),
      h('span', { style: { fontSize: '12.5px', fontWeight: '600', minWidth: '92px' } }, b.label),
      h('span', { class: 'hint' }, b.note),
    )),
  );
}

/** A deep-tier aside (the muted "for the curious" prose block). */
function deep(text: string): HTMLElement {
  return h('div', { class: 'hint', style: { lineHeight: '1.65', marginBottom: '10px' } }, text);
}

export const ARTICLES: WikiArticle[] = [
  {
    id: 'verdict',
    title: 'What the verdict means',
    blurb: 'The traffic-light read and how the band is decided.',
    plain: () => h('div', null,
      wikiPara('The verdict is a quick traffic-light read of how ready you are to play well right now. Green is good, amber means a heavy load, and red means it’s time to back off.'),
      bandList(),
    ),
    howItWorks: () => h('div', null,
      wikiPara('The band comes straight from a single 0–100 score, so the number and the label can never disagree.'),
      wikiPara('A low score alone isn’t red. “In the hole” also needs corroboration — a genuinely heavy load — plus a second, independent warning sign (a real results dip or clearly elevated tilt). One warning sign on its own stops at amber.'),
    ),
    deep: (nav: WikiNav) => h('div', null,
      deep(deepCopy.anchorAndCaps()),
      deep('Red keeps two hard gates on top of the score: load corroboration (a sustained multi-day grind or a single marathon session) AND a fully populated history — so the red label never fires off a thin baseline.'),
      wikiPara(wikiLink('See real player scenarios →', () => nav.goto({ view: 'scenarios' }))),
    ),
  },

  {
    id: 'what-moves-the-score',
    title: 'What moves the score',
    blurb: 'The three families that push the score, and their weights.',
    plain: () => h('div', null,
      wikiPara('Three things move your score up or down from a neutral middle:'),
      h('ul', { style: { margin: '0 0 10px', paddingLeft: '18px', fontSize: '13px', lineHeight: '1.7', color: 'var(--text-2)' } },
        h('li', null, h('b', null, 'Training load'), ' — how much you’re playing and resting.'),
        h('li', null, h('b', null, 'Results vs your usual'), ' — your wins and stats against your own baseline.'),
        h('li', null, h('b', null, 'Self-report'), ' — tilt and how you rate your own play.'),
      ),
    ),
    howItWorks: () => h('div', null,
      wikiPara('Each family has a different weight. Your objective results carry the most; your self-report carries the least — so a bad mood can never outweigh the evidence.'),
      wikiPara('Everything is judged against YOUR OWN history, never other players: a stat only counts once you’ve enough games behind it for a fair comparison.'),
    ),
    deep: (nav: WikiNav) => h('div', null,
      deep(deepCopy.anchorAndCaps()),
      wikiHeading('How a results dip is spotted'),
      deep(deepCopy.declineDetection()),
      wikiHeading('Self-report is deliberately weak'),
      deep(deepCopy.tiltCaps()),
      wikiHeading('Two fairness guardrails'),
      deep(deepCopy.dampenerAndOutcomeCap()),
      wikiPara(wikiLink('Walk through YOUR score →', () => nav.goto({ view: 'personalized' }))),
    ),
  },

  {
    id: 'training-load',
    title: 'Training load',
    blurb: 'Games, rest, streaks — measured against your own norm.',
    plain: () => h('div', null,
      wikiPara('Training load is about how much you’re playing and resting — games a day, days in a row without a break, session length, and days since you last played.'),
      wikiPara('It watches both directions: grinding without rest, and long layoffs or too few sessions a week to actually improve.'),
    ),
    howItWorks: () => h('div', null,
      wikiPara('Load is measured against YOUR OWN norm — a stable ten-games-a-day rhythm is habit, not risk. Only surging above your usual (or grinding with no rest days) costs points.'),
      wikiPara('When your live match stats are available, the app can see your results directly, so raw volume matters less. On manual logs, sheer exposure becomes the evidence on its own.'),
    ),
    deep: (nav: WikiNav) => h('div', null,
      deep(deepCopy.loadRatio()),
      deep('When results can’t be measured (manual logs), an absolute-load read — days without rest, daily volume, marathon sessions — fades in to fill the gap, and fades back out as live-stat coverage grows. It can never reach red on its own.'),
      wikiPara(wikiLink('See real player scenarios →', () => nav.goto({ view: 'scenarios' }))),
    ),
  },

  {
    id: 'readiness-trend',
    title: 'The readiness trend',
    blurb: 'The 3-week chart, supercompensation and rust.',
    plain: () => h('div', null,
      wikiPara('The trend chart shows your readiness over the last three weeks. Higher is fresher, and greyed columns are days you didn’t play.'),
    ),
    howItWorks: () => h('div', null,
      wikiPara('Rest works like training itself: a few days off don’t just undo fatigue — they can leave you sharper than before (supercompensation). Stay away too long, though, and sharpness fades into rust.'),
      h('div', { style: { display: 'flex', gap: '14px', alignItems: 'center', flexWrap: 'wrap', margin: '4px 0 6px' } },
        supercompensationSchematic(),
        h('div', { class: 'hint', style: { flex: '1', minWidth: '190px', lineHeight: '1.55' } },
          'Training tires you (the dip), then rest lifts you above your old baseline (the rebound). Grinding without recovery keeps you stuck in the dip; resting past the rebound decays it back down (rust).'),
      ),
    ),
    deep: (nav: WikiNav) => h('div', null,
      deep(deepCopy.restAndRust()),
      wikiHeading('The consistency nudge never pushes volume'),
      deep(deepCopy.rankNudge()),
      wikiPara(wikiLink('See real player scenarios →', () => nav.goto({ view: 'scenarios' }))),
    ),
  },
];

const BY_ID = new Map<WikiArticleId, WikiArticle>(ARTICLES.map((a) => [a.id, a]));

export function articleById(id: WikiArticleId): WikiArticle {
  const a = BY_ID.get(id);
  if (!a) throw new Error(`Unknown wiki article: ${id}`);
  return a;
}
