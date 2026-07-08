/**
 * Readiness help wiki — the drawer host. Opens one right-hand drawer and runs a
 * tiny Overview → article mini-app inside it: an in-closure page stack drives a
 * breadcrumb + Back and a per-article tier toggle, re-rendering only an inner
 * region (never the panel, so the built-in ✕ survives). The host OWNS navigation
 * and injects a `nav` callback into every content builder.
 *
 * Reachable from the Readiness view's global Help and each card's "?" — the sole
 * home for the readiness methodology (the old modal is retired).
 */
import { h, render } from '../../dom';
import { openDrawer } from '../../components/overlay';
import { segmented } from '../../components/primitives';
import { ARTICLES, articleById } from './articles';
import { scenarioLibrary } from './scenarioLibrary';
import { personalizedArticle } from './personalized';
import { wikiPara } from './ui';
import type { WikiArticleId, WikiNav, WikiRoute, WikiTier } from './types';
import type { ViewContext } from '../../views/view';

const TIER_LABEL: Array<{ value: WikiTier; label: string }> = [
  { value: 'plain', label: 'Simple' },
  { value: 'how-it-works', label: 'How it works' },
  { value: 'deep', label: 'Deep dive' },
];

/**
 * Open the readiness guide. `initial` lets a card "?" deep-link straight to its
 * article (always at the plain tier); the global Help omits it to land on Overview.
 */
export function openReadinessWiki(ctx: ViewContext, initial: WikiRoute = { view: 'overview' }): void {
  openDrawer((close) => {
    const region = h('div');
    // Seed an implicit Overview base under any deep link so Back is always present
    // and lands on the guide's Overview (deep-linked articles have no prior page).
    const stack: WikiRoute[] =
      initial.view === 'overview' ? [initial] : [{ view: 'overview' }, initial];

    const draw = (): void => {
      const route = stack[stack.length - 1];
      render(region, breadcrumb(stack, nav), pageFor(route, ctx, nav));
      // Reset scroll on navigation (the .drawer-panel is the scroll container).
      const panel = region.parentElement;
      if (panel) panel.scrollTop = 0;
    };

    const nav: WikiNav = {
      goto: (route) => { stack.push(route); draw(); },
      replace: (route) => { stack[stack.length - 1] = route; draw(); },
      back: () => { if (stack.length > 1) { stack.pop(); draw(); } },
      home: () => { stack.length = 0; stack.push({ view: 'overview' }); draw(); },
      close,
    };

    draw();
    return region;
  }, { panelClass: 'drawer-panel--wide' });
}

function pageFor(route: WikiRoute, ctx: ViewContext, nav: WikiNav): Node {
  switch (route.view) {
    case 'overview':
      return overviewPage(nav);
    case 'article':
      return articlePage(route.id, route.tier, nav);
    case 'scenarios':
      return scenarioLibrary(ctx, nav);
    case 'personalized':
      return personalizedArticle(ctx, nav);
  }
}

function routeTitle(route: WikiRoute): string {
  switch (route.view) {
    case 'overview':
      return 'Overview';
    case 'article':
      return articleById(route.id).title;
    case 'scenarios':
      return 'Player scenarios';
    case 'personalized':
      return 'Your readiness right now';
  }
}

function breadcrumb(stack: WikiRoute[], nav: WikiNav): HTMLElement {
  const route = stack[stack.length - 1];
  const atRoot = stack.length === 1 && route.view === 'overview';
  return h('div', { class: 'wiki-breadcrumb' },
    stack.length > 1
      ? h('button', { class: 'wiki-back', title: 'Back', on: { click: () => nav.back() } }, '‹ Back')
      : null,
    h('div', { class: 'wiki-trail' },
      h('button', { class: 'inline-link wiki-crumb', on: { click: () => nav.home() } }, 'Guide'),
      atRoot ? null : h('span', { class: 'wiki-crumb-sep' }, '›'),
      atRoot ? null : h('span', { class: 'wiki-crumb-current' }, routeTitle(route)),
    ),
  );
}

function overviewPage(nav: WikiNav): HTMLElement {
  const indexItem = (title: string, blurb: string, onClick: () => void): HTMLElement =>
    h('button', { class: 'wiki-index-item', on: { click: onClick } },
      h('div', { class: 'wiki-index-title' }, title),
      h('div', { class: 'hint' }, blurb),
    );

  return h('div', null,
    h('div', { class: 'wiki-title' }, 'Readiness guide'),
    wikiPara('What the Readiness screen is telling you — start simple, and dig deeper wherever you like.'),

    h('div', { style: { marginBottom: '4px' } },
      indexItem('Your readiness right now →', 'A personal breakdown of your current score.', () => nav.goto({ view: 'personalized' })),
    ),

    h('div', { class: 'wiki-group-title' }, 'How it works'),
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
      ...ARTICLES.map((a) => indexItem(a.title, a.blurb, () => nav.goto({ view: 'article', id: a.id, tier: 'plain' }))),
    ),

    h('div', { class: 'wiki-group-title' }, 'Learn from examples'),
    indexItem('Player scenarios', 'Real situations and the score each produces.', () => nav.goto({ view: 'scenarios' })),
  );
}

function articlePage(id: WikiArticleId, tier: WikiTier, nav: WikiNav): HTMLElement {
  const article = articleById(id);
  const content = tier === 'plain' ? article.plain(nav) : tier === 'how-it-works' ? article.howItWorks(nav) : article.deep(nav);
  return h('div', null,
    h('div', { class: 'wiki-title' }, article.title),
    h('div', { style: { margin: '2px 0 14px' } },
      segmented<WikiTier>({
        options: TIER_LABEL,
        value: tier,
        onChange: (t) => nav.replace({ view: 'article', id, tier: t }),
        fill: true,
      }),
    ),
    content,
  );
}
